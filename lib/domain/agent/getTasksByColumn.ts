// lib/domain/agent/getTasksByColumn.ts
// MCP Contract v0.8.0 §4.1. Read-only — no quota.
// Smart Backlog: blocking_value = depth-1 downstream tasks unlocked by completion.

import { getSupabaseClient } from '../../shared/mcpAuth';
import { invalidParams, internalError } from '../../shared/errors';
import type {
  GetTasksByColumnParams,
  GetTasksByColumnResult,
  DomainResult,
  TaskPreview,
} from '../../shared/types';

const VALID_COLUMNS = ['backlog', 'in_progress', 'review', 'done'] as const;

export async function getTasksByColumn(
  params: GetTasksByColumnParams
): Promise<DomainResult<GetTasksByColumnResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  if (!params.column || !VALID_COLUMNS.includes(params.column)) {
    throw invalidParams(
      `Invalid column. Must be one of: ${VALID_COLUMNS.join(', ')}`
    );
  }
  const limit = Math.min(params.limit ?? 20, 50);

  // Note: tasks.full_id is not a physical column — it's derived from
  // workspaces.task_prefix + task_number (see task_full_id()).
  let query = supabase
    .from('tasks')
    .select(
      'id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, task_number'
    )
    .eq('workspace_id', workspaceId)
    .eq('column', params.column)
    .order('created_at', { ascending: true })
    .limit(limit);

  // assigned_to_me → resolve agent worker (INV-04 auto-create may not have run yet)
  if (params.assigned_to_me) {
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      // Agent workers use prefixed source_id per Master Spec §6.2 ('agent::<name>')
      .eq('source_id', `agent::${agentName}`)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!worker) return { success: true, tasks: [] };
    query = query.eq('assigned_to', worker.id as string);
  }

  const { data: tasks, error: fetchError } = await query;
  if (fetchError) {
    console.error('Get tasks error:', fetchError);
    throw internalError('Failed to fetch tasks.');
  }

  // Resolve workspace prefix once to build full_id client-side
  const { data: ws } = await supabase
    .from('workspaces')
    .select('task_prefix')
    .eq('id', workspaceId)
    .maybeSingle();
  const prefix = (ws?.task_prefix as string | null) ?? 'TASK';

  const resultTasks: TaskPreview[] = (tasks ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    column: t.column as string,
    assigned_to: (t.assigned_to as string | null) ?? null,
    reviewer_id: (t.reviewer_id as string | null) ?? null,
    version: t.version as number,
    is_inbox: t.is_inbox as boolean,
    is_blocked: t.is_blocked as boolean,
    full_id: `${prefix}-${t.task_number ?? 0}`,
    task_number: (t.task_number as number) ?? 0,
  }));

  // Smart Backlog (only backlog): blocking_value = count of downstream blocks
  if (params.sort_by_blocking_value && params.column === 'backlog') {
    await Promise.all(
      resultTasks.map(async (task) => {
        const { count } = await supabase
          .from('task_relations')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('from_task_id', task.id)
          .eq('relation_type', 'blocks');
        task.blocking_value = count ?? 0;
      })
    );
    resultTasks.sort((a, b) => (b.blocking_value ?? 0) - (a.blocking_value ?? 0));
  }

  return { success: true, tasks: resultTasks };
}