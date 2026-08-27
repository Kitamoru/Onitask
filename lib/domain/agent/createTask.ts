// lib/domain/agent/createTask.ts
// MCP Contract v0.8.0 §4.3.
// Flow: rate limit (PG count) → blocker exists → DFS cycle BEFORE INSERT →
//       atomic quota → insert task (+ optional blocks edge) → agent_events.

import {
  getSupabaseClient,
  checkTaskCreationRateLimit,
  checkAndDecrementQuota,
  detectCircularDependency,
  inferComplexity,
  logAgentEvent,
  resolveAgentWorkerId,
} from '../../shared/mcpAuth';
import {
  invalidParams,
  blockerNotFound,
  circularDependency,
  workerNotFound,
  internalError,
} from '../../shared/errors';
import type {
  CreateTaskParams,
  CreateTaskResult,
  DomainResult,
} from '../../shared/types';

const VALID_COLUMNS = ['backlog', 'in_progress', 'review'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export async function createTask(
  params: CreateTaskParams
): Promise<DomainResult<CreateTaskResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  // --- Validation -----------------------------------------------------------
  if (!params.title || typeof params.title !== 'string') {
    throw invalidParams('title is required.');
  }
  if (params.column && !VALID_COLUMNS.includes(params.column)) {
    throw invalidParams(
      `Invalid column value. Must be one of: ${VALID_COLUMNS.join(', ')}`
    );
  }
  if (
    params.priority &&
    !VALID_PRIORITIES.includes(params.priority)
  ) {
    throw invalidParams(
      `Invalid priority value. Must be one of: ${VALID_PRIORITIES.join(', ')}`
    );
  }
  if (params.complexity && ![1, 2, 3].includes(params.complexity)) {
    throw invalidParams('Invalid complexity value. Must be 1, 2, or 3.');
  }
  if (params.deadline && isNaN(Date.parse(params.deadline))) {
    throw invalidParams('Invalid deadline format. Use ISO 8601.');
  }

  // --- Rate limit (Postgres count over agent_events, 60s rolling window) ----
  await checkTaskCreationRateLimit(
    workspaceId,
    agentName,
    key.maxTasksPerMinute
  );

  // --- Blocker checks BEFORE any INSERT --------------------------------------
  let relationCreated = false;
  if (params.blocked_by) {
    const { data: blockerTask } = await supabase
      .from('tasks')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', params.blocked_by)
      .maybeSingle();

    if (!blockerTask) throw blockerNotFound();

    // DFS cycle check before INSERT (contract §4.3). For a brand-new task a
    // cycle is structurally impossible; the self-reachability probe is kept
    // for contract uniformity with POST /api/tasks/:id/relations.
    const hasCycle = await detectCircularDependency(
      workspaceId,
      params.blocked_by,
      params.blocked_by
    );
    if (hasCycle) throw circularDependency();
  }

  // --- Atomic quota (A-3) ----------------------------------------------------
  await checkAndDecrementQuota(workspaceId, agentName);

  // --- Resolve assignee -------------------------------------------------------
  let assignedTo: string | null = null;
  if (params.assignee) {
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', params.assignee)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle();
    if (!worker) throw workerNotFound(params.assignee);
    assignedTo = worker.id as string;
  }

  // --- Author attribution (tasks.created_by → workers.id) --------------------
  // Own worker (INV-04). Fixes bot_notify recipient resolution (assignment /
  // done / started notifications target tasks.created_by) and the
  // '✍️ Постановщик' line of the unified task card for agent-created tasks.
  const authorWorkerId = await resolveAgentWorkerId(agentName, workspaceId);

  // --- Workspace task_prefix (INV-11) ----------------------------------------
  const { data: ws } = await supabase
    .from('workspaces')
    .select('task_prefix')
    .eq('id', workspaceId)
    .maybeSingle();

  // --- Insert task -------------------------------------------------------------
  const resolvedColumn = params.column ?? 'backlog';
  const isInbox = !params.column; // no explicit column → inbox
  const resolvedComplexity =
    params.complexity ?? inferComplexity(params.description);
  const resolvedPriority = params.priority ?? 'medium';

  const { data: counterData, error: counterError } = await supabase.rpc(
    'next_task_number',
    { p_workspace_id: workspaceId }
  );
  if (counterError || typeof counterData !== 'number') {
    throw internalError('Failed to generate task number.');
  }

  const { data: newTask, error: insertError } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      task_number: counterData,
      title: params.title,
      description: params.description ?? null,
      raw_input: `${params.title}
${params.description ?? ''}`,
      column: resolvedColumn,
      priority: resolvedPriority,
      assigned_to: assignedTo,
      created_by: authorWorkerId ?? null,
      tags: params.tags ?? [],
      deadline: params.deadline
        ? new Date(params.deadline).toISOString()
        : null,
      complexity: resolvedComplexity,
      is_inbox: isInbox,
      is_blocked: !!params.blocked_by,
      source: 'mcp',
      enrichment_strategy: 'standard',
      cognitive_weight: 1, // updated later by F-03
      clarity_score: null,
      version: 1,
    })
    .select('id, task_number, title, column, created_at, version')
    .single();

  if (insertError || !newTask) {
    console.error('Task insert error:', insertError);
    throw internalError('Failed to create task.');
  }

  // --- Optional blocks edge -----------------------------------------------------
  if (params.blocked_by) {
    const { error: relError } = await supabase.from('task_relations').insert({
      workspace_id: workspaceId, // INV-13: passed explicitly
      from_task_id: params.blocked_by,
      to_task_id: newTask.id,
      relation_type: 'blocks',
      weight: 1.0,
    });
    if (!relError) relationCreated = true;
  }

  // --- Memento / audit trail -----------------------------------------------------
  await logAgentEvent(
    workspaceId,
    agentName,
    'create_task',
    newTask.id as string,
    `Created task: ${params.title}`,
    {
      column: resolvedColumn,
      priority: resolvedPriority,
      complexity: resolvedComplexity,
      blocked_by: params.blocked_by ?? null,
      relation_created: relationCreated,
    },
    null
  );

  return {
    success: true,
    task: {
      task_id: newTask.id as string,
      task_number: newTask.task_number as number,
      full_id: `${(ws?.task_prefix as string) ?? 'TASK'}-${newTask.task_number}`,
      title: newTask.title as string,
      column: newTask.column as string,
      created_at: newTask.created_at as string,
      version: newTask.version as number,
      relation_created: relationCreated,
    },
  };
}