-- Migration 049: Duty Mode — agent autonomy levels + duty playbook
-- Purpose:
--   1) mcp_agent_keys.autonomy_level — per-key autonomy tier
--      ('observer' | 'tasks' | 'full'). Resolved in resolveAgentKey and
--      returned to the agent via get_workspace_settings.autonomy_level.
--      'observer' keys are created with read-only allowed_tools (UI mapping);
--      hard enforcement remains in allowed_tools (LLM-6 Excessive Agency).
--   2) workspace_settings.agent_duty_playbook — optional Admin override of the
--      duty-mode protocol per level: {"observer": text|null, "tasks": ...,
--      "full": ...}. NULL/missing section falls back to built-in defaults
--      (lib/shared/dutyPlaybook.ts). Served to agents via
--      get_workspace_settings.duty_playbook, resolved by the CALLING key's
--      autonomy_level (deterministic server-side selection, not LLM discretion).

ALTER TABLE public.mcp_agent_keys
  ADD COLUMN IF NOT EXISTS autonomy_level text NOT NULL DEFAULT 'tasks';

ALTER TABLE public.mcp_agent_keys DROP CONSTRAINT IF EXISTS mcp_agent_keys_autonomy_level_check;
ALTER TABLE public.mcp_agent_keys
  ADD CONSTRAINT mcp_agent_keys_autonomy_level_check
  CHECK (autonomy_level IN ('observer', 'tasks', 'full'));

COMMENT ON COLUMN public.mcp_agent_keys.autonomy_level IS
  'Duty-mode autonomy tier: observer (read-only), tasks (autonomous task work), full (tasks + post-approval deploy). Returned to agents via get_workspace_settings.autonomy_level; hard enforcement stays in allowed_tools.';

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS agent_duty_playbook jsonb;

COMMENT ON COLUMN public.workspace_settings.agent_duty_playbook IS
  'Admin-editable duty-mode protocol overrides per autonomy level: {"observer": text|null, "tasks": text|null, "full": text|null}. NULL/missing level falls back to built-in defaults. Served resolved-by-key-level via get_workspace_settings.duty_playbook.';