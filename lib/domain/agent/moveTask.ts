// lib/domain/agent/moveTask.ts
// MCP Contract v0.8.0 §4.4.
// Breaking v0.8.0: `version` is REQUIRED (optimistic locking, INV-09).
// Effects: atomic column move, is_inbox=false, claim, cascade unblock on done,
//          handoff reset when target claims in_progress.

import {
  getSupabaseClient,
  checkAndDecrementQuota,
  logAgentEvent,
  resolveAgentWorkerId,
} from '../../shared/mcpAuth';
import {
  invalidParams,
  taskNotFound,
  workerNotFound,
  alreadyClaimed,
  versionConflict,
  internalError,
  DomainError,
} from '../../shared/errors';
import type {
  MoveTaskParams,
  MoveTaskResult,
  DomainResult,
  TaskColumn,
} from '../../shared/types';

const VALID_COLUMNS: TaskColumn[] = ['backlog', 'in_progress', 'review', 'done'];

export async function moveTask(
  params: MoveTaskParams
): Promise<DomainResult<MoveTaskResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  // --- Validation ------------------------------------------------------------
  // version is REQUIRED in v0.8.0 (guard-level check duplicated here so the
  // domain service is safe when called directly).
  if (
    params.version === undefined ||
    params.version === null ||
    typeof params.version !== 'number'
  ) {
    throw invalidParams('version is required for move_task.');
  }
  if (!params.task_id || !params.target_column) {
    throw invalidParams('task_id and target_column are required.');
  }
  if (!VALID_COLUMNS.includes(params.target_column)) {
    throw invalidParams(
      `Invalid target_column. Must be one of: ${VALID_COLUMNS.join(', ')}`
    );
  }

  // --- Atomic quota (A-3) ------------------------------------------------------
  await checkAndDecrementQuota(workspaceId, agentName);

  // --- Current state -------------------------------------------------------------
  const { data: currentTask, error: fetchError } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id)
    .maybeSingle();

  if (fetchError || !currentTask) throw taskNotFound();

  // --- Review approval guard (миграция 049) ---------------------------------
  // Задача без назначенного reviewer в 'review' требует человеческого
  // согласования перед 'done' (кнопка «Согласовать» в Telegram-уведомлении).
  if (
    currentTask.column === 'review' &&
    params.target_column === 'done' &&
    !currentTask.reviewer_id &&
    ((currentTask.metadata ?? {}) as Record<string, unknown>).review_pending ===
      true
  ) {
    throw new DomainError(
      409,
      'review_approval_required',
      'Task is in review and requires human approval before moving to done. Use the Approve button in the Telegram notification.'
    );
  }


  // --- Claim -----------------------------------------------------------------------
  let claimed = false;
  let assignedTo: string | null = currentTask.assigned_to;

  if (params.claim) {
    const workerId = await resolveAgentWorkerId(agentName, workspaceId);
    if (!workerId) throw workerNotFound(agentName);

    if (currentTask.assigned_to && currentTask.assigned_to !== workerId) {
      throw alreadyClaimed();
    }
    assignedTo = workerId;
    claimed = true;
  }

  const stateBefore = {
    column: currentTask.column,
    assigned_to: currentTask.assigned_to,
    version: currentTask.version,
    is_inbox: currentTask.is_inbox,
  };

  // --- Optimistic update (INV-09): WHERE id AND version ------------------------------
  const updateData: Record<string, unknown> = {
    column: params.target_column,
    is_inbox: false,
    updated_at: new Date().toISOString(),
  };
  if (claimed && assignedTo) {
    updateData.assigned_to = assignedTo;
  }
  // Contract §4.8: claiming in_progress resets pending handoff
  if (
    params.target_column === 'in_progress' &&
    (currentTask.handoff_to !== null || currentTask.handoff_notes !== null)
  ) {
    updateData.handoff_to = null;
    updateData.handoff_notes = null;
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id)
    .eq('version', params.version) // optimistic lock
    .select('id');

  if (updateError) {
    console.error('Move task update error:', updateError);
    throw internalError('Failed to move task.');
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw versionConflict();
  }

  // Fresh version (DB trigger may bump atomically)
  const { data: freshRow } = await supabase
    .from('tasks')
    .select('version')
    .eq('id', params.task_id)
    .maybeSingle();
  const newVersion = (freshRow?.version as number) ?? params.version + 1;

  // --- Cascade unblock on done (A-12) ---------------------------------------------------
  let unblockedIds: string[] = [];
  if (params.target_column === 'done') {
    const { data: edges } = await supabase
      .from('task_relations')
      .select('to_task_id')
      .eq('workspace_id', workspaceId)
      .eq('from_task_id', params.task_id)
      .eq('relation_type', 'blocks');

    for (const edge of edges ?? []) {
      const downstreamId = edge.to_task_id as string;
      // Downstream task is unblocked when NO blocker remains outside done
      const { data: remainingBlockers } = await supabase
        .from('task_relations')
        .select(
          'from_task_id, tasks!task_relations_from_task_id_fkey(column)'
        )
        .eq('workspace_id', workspaceId)
        .eq('to_task_id', downstreamId)
        .eq('relation_type', 'blocks');

      const stillBlocked = (remainingBlockers ?? []).some((b) => {
        const col = (b as Record<string, unknown>).tasks as
          | { column?: string }
          | undefined;
        return col?.column && col.column !== 'done';
      });

      if (!stillBlocked) unblockedIds.push(downstreamId);
    }
  }

  // --- Memento / audit trail ---------------------------------------------------------------
  await logAgentEvent(
    workspaceId,
    agentName,
    'move_task',
    params.task_id,
    `Moved task ${params.task_id} from ${currentTask.column} to ${params.target_column}${params.reason ? ': ' + params.reason : ''}`,
    {
      from_column: currentTask.column,
      to_column: params.target_column,
      reason: params.reason ?? null,
      claimed,
    },
    stateBefore
  );

  return {
    success: true,
    task_id: params.task_id,
    new_column: params.target_column,
    claimed,
    version: newVersion,
    moved_at: new Date().toISOString(),
    unblocked_ids: unblockedIds,
  };
}