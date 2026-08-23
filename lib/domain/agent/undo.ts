// lib/domain/agent/undo.ts
// MCP Contract v0.8.0 §4.9.
// Memento pattern: restores task state from agent_events.state_before.
// Constraints: 5-minute window; only events of the current agent_name.
// Post-MVP: compare-and-swap by version (not blocking MVP).

import {
  getSupabaseClient,
  logAgentEvent,
} from '../../shared/mcpAuth';
import { invalidParams, internalError } from '../../shared/errors';
import type {
  UndoParams,
  UndoResult,
  DomainResult,
} from '../../shared/types';

const UNDO_WINDOW_MINUTES = 5;

export async function undo(
  params: UndoParams
): Promise<DomainResult<UndoResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  if (!params.event_id) throw invalidParams('event_id is required.');

  // --- Find the event (own agent_name + workspace only) -------------------------
  const { data: event, error: fetchError } = await supabase
    .from('agent_events')
    .select('*')
    .eq('id', params.event_id)
    .eq('workspace_id', workspaceId)
    .eq('agent_name', agentName)
    .maybeSingle();

  if (fetchError || !event) throw internalError('Event not found.');

  if ((event.is_undone as boolean) === true) {
    return { success: true, restored: false };
  }

  // --- 5-minute window ------------------------------------------------------------
  const eventTime = new Date(event.created_at as string);
  const diffMinutes =
    (Date.now() - eventTime.getTime()) / 60000;
  if (diffMinutes > UNDO_WINDOW_MINUTES) {
    throw new (await import('../../shared/errors')).DomainError(
      410,
      'undo_window_expired',
      `Undo window expired: event is ${Math.round(diffMinutes)} minutes old (max ${UNDO_WINDOW_MINUTES} minutes).`
    );
  }

  // --- state_before (dedicated column, fallback to metadata for legacy rows) --------
  const metadata = (event.metadata as Record<string, unknown>) ?? {};
  const stateBefore =
    (event.state_before as Record<string, unknown> | null) ??
    (metadata.state_before as Record<string, unknown> | null);

  if (!stateBefore) {
    throw invalidParams(
      'This event does not have state_before data. Cannot undo.'
    );
  }

  const tool = event.tool as string;
  const taskId = event.task_id as string | null;
  let restored = false;

  switch (tool) {
    case 'create_task': {
      if (taskId) {
        await supabase.from('task_relations').delete().or(
          `from_task_id.eq.${taskId},to_task_id.eq.${taskId}`
        );
        await supabase.from('tasks').delete().eq('id', taskId);
        restored = true;
      }
      break;
    }
    case 'move_task': {
      if (taskId && stateBefore.column) {
        await supabase
          .from('tasks')
          .update({
            column: stateBefore.column as string,
            assigned_to: (stateBefore.assigned_to as string | null) ?? null,
            is_inbox: (stateBefore.is_inbox as boolean) ?? false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', taskId);
        restored = true;
      }
      break;
    }
    case 'escalate_task': {
      if (taskId) {
        await supabase
          .from('tasks')
          .update({
            needs_human: false,
            escalation_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', taskId);
        restored = true;
      }
      break;
    }
    case 'handoff_task': {
      if (taskId) {
        await supabase
          .from('tasks')
          .update({
            handoff_to: null,
            handoff_notes: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', taskId);
        restored = true;
      }
      break;
    }
    default:
      throw invalidParams(`Undo not supported for tool: ${tool}`);
  }

  // --- Mark undone + audit trail ------------------------------------------------------
  await supabase
    .from('agent_events')
    .update({ is_undone: true })
    .eq('id', params.event_id);

  await logAgentEvent(
    workspaceId,
    agentName,
    'undo',
    taskId,
    `Undid previous action: ${tool}`,
    {
      original_event_id: params.event_id,
      original_tool: tool,
    },
    null
  );

  return { success: true, restored };
}