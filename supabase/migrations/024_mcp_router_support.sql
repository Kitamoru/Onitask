-- Migration 024: MCP Router Support
-- Purpose: Provide database infrastructure for the MCP Agent Router (Stage 7).
--          Includes: check_and_decrement_quota RPC, telegram_message_queue table,
--          is_undone column on agent_events, and supporting indexes/policies.

-- ============================================================================
-- Part 1: Add is_undone column to agent_events
-- ============================================================================

ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS is_undone boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agent_events.is_undone IS
  'Memento pattern flag: true when this event has been undone via /api/mcp/undo/:eventId.';

CREATE INDEX IF NOT EXISTS idx_agent_events_is_undone
  ON public.agent_events (workspace_id, agent_name, created_at DESC)
  WHERE is_undone = false;

-- ============================================================================
-- Part 2: Create telegram_message_queue table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telegram_chat_id text NOT NULL,
  message text NOT NULL CHECK (char_length(message) <= 4000),
  source_agent text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.telegram_message_queue IS
  'Queue for async delivery of AI agent messages to Telegram chats.';

COMMENT ON COLUMN public.telegram_message_queue.status IS
  'pending | sent | failed | retrying';

-- Indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_telegram_queue_status_priority_created
  ON public.telegram_message_queue (status, priority ASC, created_at ASC)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_telegram_queue_workspace_status
  ON public.telegram_message_queue (workspace_id, status)
  WHERE status IN ('pending', 'retrying');

-- RLS policies for telegram_message_queue
ALTER TABLE public.telegram_message_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (handled by Supabase edge functions)
CREATE POLICY "service_role_full_access_on_telegram_message_queue"
  ON public.telegram_message_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Agents can insert their own messages
CREATE POLICY "agents_insert_own_messages_on_telegram_message_queue"
  ON public.telegram_message_queue
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true); -- Will be enforced by API layer via mcpAuth

-- Read-only access for agents to their own workspace's queue
CREATE POLICY "agents_read_own_workspace_queue_on_telegram_message_queue"
  ON public.telegram_message_queue
  FOR SELECT
  TO anon, authenticated
  USING (true); -- Enforced by API layer

-- Update policy (only service role should update status)
CREATE POLICY "service_role_update_queue_on_telegram_message_queue"
  ON public.telegram_message_queue
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Part 3: RPC function check_and_decrement_quota
-- ============================================================================

-- Creates a function that atomically checks and decrements AI mutation quota.
-- Returns JSON: { success: boolean, remaining: int }
-- If quota is exhausted, returns { success: false, remaining: 0 }.

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

  -- Decrement (logically — we don't store decrement, just verify at creation time)
  -- The actual enforcement happens by checking count before each mutation.
  -- This function serves as an atomic gate.

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

-- ============================================================================
-- Part 4: Helper function for next_task_number (if not already exists)
-- ============================================================================

-- This function may already exist from earlier migrations. We use CREATE OR REPLACE
-- to ensure it's always up-to-date.

CREATE OR REPLACE FUNCTION public.next_task_number(p_workspace_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_number integer;
BEGIN
  SELECT COALESCE(MAX(task_number), 0) + 1
  INTO v_next_number
  FROM public.tasks
  WHERE workspace_id = p_workspace_id;

  RETURN v_next_number;
END;
$$;

COMMENT ON FUNCTION public.next_task_number IS
  'Returns the next sequential task number for a workspace. Used by MCP create_task handler.';

-- ============================================================================
-- Part 5: Detect circular dependency helper (DFS cycle check)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.detect_circular_dependency(
  p_workspace_id uuid,
  p_from_task_id uuid,
  p_to_task_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visited uuid[] := ARRAY[]::uuid[];
  v_has_cycle boolean := false;
BEGIN
  -- Simple DFS: check if following 'blocks' edges from p_to_task_id leads back to p_from_task_id
  PERFORM public._dfs_check_cycle(p_workspace_id, p_to_task_id, p_from_task_id, v_visited, v_has_cycle);

  RETURN v_has_cycle;
END;
$$;

-- Internal recursive helper (not exposed directly)
CREATE OR REPLACE FUNCTION public._dfs_check_cycle(
  p_workspace_id uuid,
  p_current_id uuid,
  p_target_id uuid,
  p_visited uuid[],
  OUT p_has_cycle boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edge RECORD;
BEGIN
  p_has_cycle := false;

  -- Prevent infinite recursion
  IF array_length(p_visited, 1) > 100 THEN
    RETURN;
  END IF;

  -- Check if we've reached the target
  IF p_current_id = p_target_id THEN
    p_has_cycle := true;
    RETURN;
  END IF;

  -- Mark as visited
  p_visited := p_visited || p_current_id;

  -- Follow 'blocks' edges: from_task blocks to_task means from_task depends on to_task
  -- So we follow from_task_id -> to_task_id direction
  FOR v_edge IN
    SELECT from_task_id, to_task_id
    FROM public.task_relations
    WHERE workspace_id = p_workspace_id
      AND to_task_id = p_current_id
      AND relation_type = 'blocks'
      AND from_task_id <> ALL(p_visited)
  LOOP
    PERFORM public._dfs_check_cycle(p_workspace_id, v_edge.from_task_id, p_target_id, p_visited, p_has_cycle);
    IF p_has_cycle THEN
      RETURN;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.detect_circular_dependency IS
  'DFS cycle detection for task_relations. Returns true if adding a "blocks" edge from p_from_task_id to p_to_task_id would create a cycle.';

-- ============================================================================
-- Part 6: Resolve agent worker ID helper
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_agent_worker_id(
  p_source_id text,
  p_workspace_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id uuid;
BEGIN
  SELECT id INTO v_worker_id
  FROM public.workers
  WHERE source_id = p_source_id
    AND workspace_id = p_workspace_id
    AND is_active = true
  LIMIT 1;

  RETURN v_worker_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_agent_worker_id IS
  'Resolves an agent''s source_id to their worker UUID in a workspace. Returns NULL if not found or inactive.';

-- ============================================================================
-- Part 7: Update trigger for updated_at on telegram_message_queue
-- ============================================================================

-- Reuse existing trigger function if available, otherwise create one
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_telegram_queue_updated_at ON public.telegram_message_queue;

CREATE TRIGGER trg_telegram_queue_updated_at
  BEFORE UPDATE ON public.telegram_message_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Part 8: Realtime subscription for telegram_message_queue
-- ============================================================================

ALTER TABLE public.telegram_message_queue
  REPLICA IDENTITY FULL;

COMMENT ON TABLE public.telegram_message_queue IS
  'Queue for async delivery of AI agent messages to Telegram chats. REPLICA IDENTITY FULL enables realtime updates for queue status changes.';