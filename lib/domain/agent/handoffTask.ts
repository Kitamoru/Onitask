// lib/domain/agent/handoffTask.ts
// MCP Contract v0.8.0 §4.8.
// Planned relay to another agent. No enriched fields (rejected in v0.8.0).
// Circular handoffs are closed by handoff_chain view + trg_handoff_chain_alert.

import {
  getSupabaseClient,
  checkAndDecrementQuota,
  logAgentEvent,
} from '../../shared/mcpAuth';
import {
  invalidParams,
  taskNotFound,
  workerNotFound,
  internalError,
} from '../../shared/errors';
import type {
  HandoffTaskParams,
  HandoffTaskResult,
  DomainResult,
} from '../../shared/types';

export async function handoffTask(
  params: HandoffTaskParams
): Promise<DomainResult<HandoffTaskResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  if (!params.task_id) throw invalidParams('task_id is required.');
  if (!params.target_agent || typeof params.target_agent !== 'string') {
    throw invalidParams('target_agent is required.');
  }
  if (!params.handoff_notes || typeof params.handoff_notes !== 'string') {
    throw invalidParams('handoff_notes is required.');
  }
  if (params.handoff_notes.length > 1000) {
    throw invalidParams('handoff_notes must be at most 1000 characters.');
  }

  // --- Atomic quota (A-3) ------------------------------------------------------
  await checkAndDecrementQuota(workspaceId, agentName);

  // --- Current state ---------------------------------------------------------------
  const { data: currentTask } = await supabase
    .from('tasks')
    .select('column, version, handoff_to, handoff_notes')
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id)
    .maybeSingle();

  if (!currentTask) throw taskNotFound();

  // --- Target worker ------------------------------------------------------------------
  // target_agent may be a human (source_id = profile id) or an agent
  // (source_id = 'agent::<name>' per Master Spec §6.2). Try both.
  let { data: targetWorker } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', params.target_agent)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  if (!targetWorker) {
    const { data: agentWorker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', `agent::${params.target_agent}`)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle();
    targetWorker = agentWorker;
  }

  if (!targetWorker) throw workerNotFound(params.target_agent);

  // --- Update ----------------------------------------------------------------------------
  const updateData: Record<string, unknown> = {
    handoff_to: targetWorker.id as string,
    handoff_notes: params.handoff_notes,
    updated_at: new Date().toISOString(),
  };
  if (params.move_to_column) {
    const validColumns = ['backlog', 'in_progress', 'review'];
    if (!validColumns.includes(params.move_to_column)) {
      throw invalidParams(
        `Invalid move_to_column. Must be one of: ${validColumns.join(', ')}`
      );
    }
    updateData.column = params.move_to_column;
    updateData.is_inbox = false;
  }

  const { error: updateError } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id);

  if (updateError) {
    console.error('Handoff task update error:', updateError);
    throw internalError('Failed to hand off task.');
  }

  // Fresh version
  const { data: freshRow } = await supabase
    .from('tasks')
    .select('version')
    .eq('id', params.task_id)
    .maybeSingle();

  // --- Memento / audit trail ---------------------------------------------------------------
  await logAgentEvent(
    workspaceId,
    agentName,
    'handoff_task',
    params.task_id,
    `Handed off task to ${params.target_agent}`,
    {
      target_agent: params.target_agent,
      move_to_column: params.move_to_column ?? null,
      notes_length: params.handoff_notes.length,
    },
    {
      handoff_to: currentTask.handoff_to,
      handoff_notes: currentTask.handoff_notes,
      column: currentTask.column,
    }
  );

  return {
    success: true,
    task_id: params.task_id,
    handed_off_to: params.target_agent,
    new_column: (params.move_to_column as string | null) ?? null,
    version: (freshRow?.version as number) ?? (currentTask.version as number),
  };
}