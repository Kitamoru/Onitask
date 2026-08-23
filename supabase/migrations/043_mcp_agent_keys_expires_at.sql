-- Migration 043: Add expires_at to mcp_agent_keys
-- Purpose: UI allows selecting key lifetime at creation (1/3/6/12 months).
--          Soft revoke stays as immediate kill-switch; expires_at = planned EOL.

ALTER TABLE public.mcp_agent_keys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN public.mcp_agent_keys.expires_at IS
  'Planned key expiration. NULL = no expiry. Soft revoke (revoked_at) remains the immediate kill-switch.';