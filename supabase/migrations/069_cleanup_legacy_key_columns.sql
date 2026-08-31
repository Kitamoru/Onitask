-- ============================================================================
-- Migration 069: Cleanup legacy mcp_agent_keys columns (ADR R1, Arch 0.9)
-- ============================================================================

-- Backfill agent_name from label for keys that have empty agent_name
UPDATE mcp_agent_keys
SET agent_name = label
WHERE (agent_name IS NULL OR agent_name = '')
  AND label IS NOT NULL AND label != '';

-- Drop CHECK constraints first (required before dropping columns)
ALTER TABLE mcp_agent_keys DROP CONSTRAINT IF EXISTS mcp_agent_keys_autonomy_level_check;
ALTER TABLE mcp_agent_keys DROP CONSTRAINT IF EXISTS mcp_agent_keys_playbook_variant_check;

-- Drop legacy columns
ALTER TABLE mcp_agent_keys DROP COLUMN IF EXISTS label;
ALTER TABLE mcp_agent_keys DROP COLUMN IF EXISTS autonomy_level;
ALTER TABLE mcp_agent_keys DROP COLUMN IF EXISTS playbook_variant;

-- Comments (cleanup)
COMMENT ON COLUMN mcp_agent_keys.agent_name IS 'Agent identity (1 key = 1 agent). Shown as "Название ключа" in UI.';