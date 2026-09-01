// lib/shared/autonomyLevels.ts
// Arch 0.9 Stage 5b: autonomy_level was removed from mcp_agent_keys
// (migration 069). All new keys default to allowed_tools = 'all'.
// READ_ONLY_ALLOWED_TOOLS is kept for reference only — the observer tier
// enforcement (LLM-6 Excessive Agency) is gone with the column.

export const DEFAULT_ALLOWED_TOOLS = 'all';

export const READ_ONLY_ALLOWED_TOOLS = [
  'get_tasks_by_column',
  'get_workspace_settings',
  'get_task_context',
];
