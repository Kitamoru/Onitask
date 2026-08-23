// lib/domain/agent/waitForTasks.ts
// MCP Contract v0.8.x §4.10 — wait_for_tasks (duty loop / long-poll).
// Read-only — no quota, no agent_events logging (would spam at poll frequency).
//
// Purpose: lets an always-on agent session block until a NEW task is assigned
// to it, instead of the operator typing "check tasks". The agent calls this
// tool in a loop when idle; the server holds the request open (long-poll)
// and returns as soon as matching work appears or the timeout elapses.
//
// Detection rule: an assigned task in backlog/in_progress/review whose id is
// NOT in known_task_ids. Tasks in 'done' never wake the caller.
// If the agent worker does not exist yet (INV-04 trigger hasn't run), the
// worker is re-resolved each poll iteration so a task assigned moments later
// is still detected.

import { getSupabaseClient } from '../../shared/mcpAuth';
import { invalidParams } from '../../shared/errors';
import type {
  DomainContext,
  DomainResult,
  TaskPreview,
} from '../../shared/types';

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SEC = 25;
const MAX_TIMEOUT_SEC = 45; // stays safely under Cline's 60s MCP client timeout
const MAX_KNOWN_IDS = 200;

export interface WaitForTasksParams extends DomainContext {
  /** Task ids the agent already knows about. New = assigned && not in this list. */
  known_task_ids?: string[];
  /** How long to hold the request open. Default 25s, max 45s. */
  timeout_sec?: number;
}

export interface WaitForTasksResult {
  status: 'new_tasks' | 'timeout';
  tasks: TaskPreview[];
  waited_ms: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForTasks(
  params: WaitForTasksParams
): Promise<DomainResult<WaitForTasksResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  const timeoutSec = Math.min(
    Math.max(params.timeout_sec ?? DEFAULT_TIMEOUT_SEC, 1),
    MAX_TIMEOUT_SEC
  );
  const deadline = Date.now() + timeoutSec * 1000;

  let knownIds: string[];
  if (params.known_task_ids === undefined || params.known_task_ids === null) {
    knownIds = [];
  } else {
    if (!Array.isArray(params.known_task_ids)) {
      throw invalidParams('known_task_ids must be an array of task UUIDs.');
    }
    if (
      params.known_task_ids.some((id) => typeof id !== 'string' || id.length === 0)
    ) {
      throw invalidParams('known_task_ids must contain non-empty string UUIDs.');
    }
    knownIds = params.known_task_ids.slice(0, MAX_KNOWN_IDS);
  }

  while (true) {
    // Re-resolve each iteration: INV-04 auto-create may run mid-wait
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', `agent::${agentName}`)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (worker) {
      const { data: rows, error } = await supabase
        .from('tasks')
        .select(
          'id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, task_number'
        )
        .eq('workspace_id', workspaceId)
        .eq('assigned_to', worker.id as string)
        .neq('column', 'done')
        .order('created_at', { ascending: true })
        .limit(50);

      if (!error && rows && rows.length > 0) {
        const fresh = rows.filter((t) => !knownIds.includes(t.id as string));
        if (fresh.length > 0) {
          // Resolve prefix once for full_id
          const { data: ws } = await supabase
            .from('workspaces')
            .select('task_prefix')
            .eq('id', workspaceId)
            .maybeSingle();
          const prefix = (ws?.task_prefix as string | null) ?? 'TASK';

          const tasks: TaskPreview[] = fresh.map((t) => ({
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

          return {
            success: true,
            status: 'new_tasks',
            tasks,
            waited_ms: timeoutSec * 1000 - (deadline - Date.now()),
          };
        }
      }
    }

    if (Date.now() >= deadline) {
      return { success: true, status: 'timeout', tasks: [], waited_ms: timeoutSec * 1000 };
    }
    await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  }
}