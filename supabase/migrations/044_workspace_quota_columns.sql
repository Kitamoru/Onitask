-- Migration 044: Workspace AI quota columns for check_and_decrement_quota RPC.
-- Bugfix: RPC public.check_and_decrement_quota (migration 024) references
-- workspace_settings.ai_mutations_per_day and workspace_settings.agent_quotas,
-- but no prior migration created them → every mutation call failed with
-- "Quota check failed." (500 internal_error).
--
-- INV/Axiom check:
--   A-03 (Atomic Quota) — gate stays atomic via RPC count over agent_events.
--   INV-08 (workspace_settings single source of settings) — quota config lives here.

-- ============================================================================
-- Part 1: Add missing columns to workspace_settings
-- ============================================================================

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS ai_mutations_per_day integer;

COMMENT ON COLUMN public.workspace_settings.ai_mutations_per_day IS
  'Default daily AI mutation quota per agent in this workspace. NULL = server default (100).';

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS agent_quotas jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.workspace_settings.agent_quotas IS
  'Per-agent daily quota overrides: {"<agent_name>": <int>}. Falls back to ai_mutations_per_day.';

-- ============================================================================
-- Part 2: Recreate quota RPC idempotently (same body as migration 024)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_and_decrement_quota(
  p_workspace_id uuid,
  p_agent_name text,
  p_cost integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quota_remaining int;
  v_reset_at timestamptz;
  v_current_usage int;
  v_max_quota int;
BEGIN
  -- Get workspace quota settings
  SELECT
    ai_mutations_per_day,
    COALESCE(agent_quotas->>p_agent_name, '100')::int
  INTO v_max_quota, v_quota_remaining
  FROM public.workspace_settings
  WHERE workspace_id = p_workspace_id
  LIMIT 1;

  -- Default to 100 if not set
  v_max_quota := COALESCE(v_max_quota, 100);

  -- Check today's usage from agent_events
  SELECT COUNT(*)
  INTO v_current_usage
  FROM public.agent_events
  WHERE workspace_id = p_workspace_id
    AND agent_name = p_agent_name
    AND tool IN ('create_task', 'move_task', 'escalate_task', 'handoff_task')
    AND created_at >= date_trunc('day', now()) AT TIME ZONE 'UTC';

  -- Calculate remaining
  v_quota_remaining := v_max_quota - v_current_usage;

  -- Check if enough quota remains
  IF v_quota_remaining < p_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'remaining', 0,
      'max', v_max_quota,
      'used', v_current_usage,
      'message', 'AI mutation quota exhausted for today.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'remaining', v_quota_remaining - p_cost,
    'max', v_max_quota,
    'used', v_current_usage + p_cost
  );
END;
$$;

COMMENT ON FUNCTION public.check_and_decrement_quota IS
  'Atomic RPC: checks AI mutation quota for an agent in a workspace and returns remaining count. Used by MCP router handlers.';