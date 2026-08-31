// lib/shared/autonomyLevels.ts
// Arch 0.9: autonomy levels removed (ADR R1). This module now exports
// the default allowed_tools policy for new keys.

/**
 * Default allowed_tools for new MCP keys in Arch 0.9.
 * All keys get full tool access; restrictions (if needed) are per-key config.
 */
export const DEFAULT_ALLOWED_TOOLS = 'all' as const;

/**
 * Read-only toolset for observer-style keys (reserved for future use).
 * Currently unused — kept for reference.
 */
export const READ_ONLY_ALLOWED_TOOLS = [
  'get_tasks_by_column',
  'get_workspace_settings',
  'get_task_context',
] as const;
