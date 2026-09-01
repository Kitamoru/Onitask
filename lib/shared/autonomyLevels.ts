// lib/shared/autonomyLevels.ts
// Autonomy level helpers (migration 049) — shared by /api/mcp-keys routes.
// Arch 0.9 ADR R1: duty playbooks are OUT OF SCOPE in 0.9 — playbook variant
// resolution was removed (DB columns remain inert); only the permission
// mapping survives here. 'observer' maps to a read-only toolset so the tier
// is enforced server-side via allowed_tools (LLM-6 Excessive Agency), not
// just reported to the agent.

import type { AutonomyLevel } from './types';

export const READ_ONLY_ALLOWED_TOOLS = [
  'get_tasks_by_column',
  'get_workspace_settings',
  'get_task_context',
];

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return value === 'observer' || value === 'tasks' || value === 'full';
}

/**
 * allowed_tools for a given autonomy level. Used at key creation AND on level
 * change (PATCH), so enforcement always matches the tier.
 */
export function allowedToolsForLevel(level: AutonomyLevel): 'all' | string[] {
  return level === 'observer' ? [...READ_ONLY_ALLOWED_TOOLS] : 'all';
}
