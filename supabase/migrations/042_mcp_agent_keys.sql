-- Migration 042: MCP Agent Keys (Master Spec §6.19, contract v0.8.0)
-- Purpose: Replace jsonb workspace_settings.mcp_api_keys with dedicated table.
--          workspace_id resolves FROM the key (key_hash unique lookup).
--          Backing store for A-2 (timingSafeEqual) and A-7 (tenant isolation).

-- ============================================================================
-- Part 1: Create mcp_agent_keys table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mcp_agent_keys (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key_hash              text NOT NULL,
  -- sha256(raw_key); compare only via timingSafeEqual (A-2)
  label                 text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  agent_type            text CHECK (agent_type IN ('cursor', 'claude_code', 'other')),
  -- nullable until UI step 2 selects format
  allowed_tools         jsonb NOT NULL DEFAULT '"all"'::jsonb,
  -- 'all' | string[]; normalize in resolveAgentKey
  can_send_messages     boolean NOT NULL DEFAULT true,
  max_tasks_per_minute  int NOT NULL DEFAULT 50,
  created_by            uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz,
  revoked_at            timestamptz
  -- soft revoke; keep row for agent_events history
);

COMMENT ON TABLE public.mcp_agent_keys IS
  'API keys for AI agents (MCP + REST transports). workspace_id resolves from key_hash. Contract v0.8.0 §2.3.';

COMMENT ON COLUMN public.mcp_agent_keys.key_hash IS
  'sha256(raw_key). Raw key is shown once at creation and never stored.';

COMMENT ON COLUMN public.mcp_agent_keys.allowed_tools IS
  'jsonb: "all" (string) or array of tool names. Normalized at runtime by resolveAgentKey.';

COMMENT ON COLUMN public.mcp_agent_keys.revoked_at IS
  'Soft revoke timestamp. Row kept for agent_events history. NULL = active.';

-- ============================================================================
-- Part 2: Indexes
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_agent_keys_hash_active
  ON public.mcp_agent_keys (key_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_agent_keys_workspace_active
  ON public.mcp_agent_keys (workspace_id)
  WHERE revoked_at IS NULL;

-- ============================================================================
-- Part 3: RLS
-- ============================================================================

ALTER TABLE public.mcp_agent_keys ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by API layer via service client)
CREATE POLICY "service_role_full_access_on_mcp_agent_keys"
  ON public.mcp_agent_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read keys of their own workspaces (via workers membership)
CREATE POLICY "members_select_own_workspace_keys_on_mcp_agent_keys"
  ON public.mcp_agent_keys
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workers w
      WHERE w.workspace_id = mcp_agent_keys.workspace_id
        AND w.source_id = auth.uid()::text
        AND w.is_active = true
    )
  );

-- ============================================================================
-- Part 4: Drop legacy jsonb column (contract v0.8.0: no alias, no legacy mode)
-- ============================================================================

ALTER TABLE public.workspace_settings
  DROP COLUMN IF EXISTS mcp_api_keys;