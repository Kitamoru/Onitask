// lib/domain/agent/escalateTask.ts
// MCP Contract v0.8.0 §4.5.
// Sets needs_human=true (+ escalation_reason). Agent MUST stop mutating the
// task until a human resolves it. Alert triggers (DB-14) fire on UPDATE.

import {
  getSupabaseClient,
  checkAndDecrementQuota,
  logAgentEvent,
} from '../../shared/mcpAuth';
import {
  invalidParams,
  taskNotFound,
  internalError,
} from '../../shared/errors';
import type {
  EscalateTaskParams,
  EscalateTaskResult,
  DomainResult,
} from '../../shared/types';

const VALID_REASONS = [
  'insufficient_context',
  'conflicting_requirements',
  'blocked_by',
  'out_of_scope',
] as const;

export async function escalateTask(
  params: EscalateTaskParams
): Promise<DomainResult<EscalateTaskResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  if (!params.task_id) throw invalidParams('task_id is required.');
  if (!params.reason || !VALID_REASONS.includes(params.reason)) {
    throw invalidParams(
      `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`
    );
  }

  // --- Atomic quota (A-3) ------------------------------------------------------
  await checkAndDecrementQuota(workspaceId, agentName);

  // --- Current state (for Memento) ------------------------------------------------
  const { data: currentTask } = await supabase
    .from('tasks')
    .select('needs_human, escalation_reason, metadata')
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id)
    .maybeSingle();

  if (!currentTask) throw taskNotFound();

  // --- Update ------------------------------------------------------------------------
  // suggested_action persists on tasks.metadata so that trg_escalation_alert can
  // include it in the bot_notify payload (bot shows "Предлагаю: ..." line).
  const { error: updateError } = await supabase
    .from('tasks')
    .update({
      needs_human: true,
      escalation_reason: params.reason,
      metadata: {
        ...(currentTask.metadata ?? {}),
        suggested_action: params.suggested_action ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id);

  if (updateError) {
    console.error('Escalate task update error:', updateError);
    throw internalError('Failed to escalate task.');
  }

  // --- Memento / audit trail ------------------------------------------------------------
  await logAgentEvent(
    workspaceId,
    agentName,
    'escalate_task',
    params.task_id,
    `Escalated task: ${params.reason}${params.suggested_action ? ` — ${params.suggested_action}` : ''}`,
    {
      reason: params.reason,
      suggested_action: params.suggested_action ?? null,
    },
    {
      needs_human: currentTask.needs_human,
      escalation_reason: currentTask.escalation_reason,
    }
  );

  return { success: true, task_id: params.task_id };
}