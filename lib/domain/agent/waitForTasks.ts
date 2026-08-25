// lib/domain/agent/waitForTasks.ts
// MCP Contract v0.8.x §4.10 — wait_for_tasks (duty loop / long-poll).
// Read-only w.r.t. tasks/quota; writes ONLY delivery-marker events
// (tool='deploy_notify'/'fix_notify', migration 050) when an approval wake is
// actually delivered — this deduplicates wakes without spamming agent_events
// at poll frequency.
//
// Purpose: lets an always-on agent session block until matching work appears,
// instead of the operator typing "check tasks". The agent calls this tool in a
// loop when idle; the server holds the request open (long-poll) and returns as
// soon as something matches or the timeout elapses.
//
// Wake criteria:
//   1) NEW TASK: an assigned task in backlog/in_progress/review whose id is
//      NOT in known_task_ids.
//   2) DEPLOY REQUEST (migration 050, autonomy_level='full' only): an assigned
//      task whose column history shows a review→done transition within the
//      last 24h (human approval). Returned in deploy_requests so the duty
//      agent can run its post-approval deploy chain even after a session
//      restart. Delivered exactly once per transition via deploy_notify
//      markers keyed by metadata.history_id.
//   3) FIX REQUEST (migration 050): an assigned task returned from review to
//      in_progress (human requested changes) — any domain. Returned in
//      fix_requests, deduplicated via fix_notify markers.
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
import type { SupabaseClient } from '@supabase/supabase-js';

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SEC = 25;
const MAX_TIMEOUT_SEC = 45; // stays safely under Cline's 60s MCP client timeout
const MAX_KNOWN_IDS = 200;
const WAKE_WINDOW_MS = 24 * 60 * 60 * 1000; // approval/fix detection window

export interface WaitForTasksParams extends DomainContext {
  /** Task ids the agent already knows about. New = assigned && not in this list. */
  known_task_ids?: string[];
  /** How long to hold the request open. Default 25s, max 45s. */
  timeout_sec?: number;
  /**
   * Client loop-guard breaker: agents pass previous value + 1 on every call.
   * Ignored by the server (validated only as a number when present).
   */
  poll_seq?: number;
}

export interface WaitForTasksResult {
  status: 'new_tasks' | 'timeout';
  tasks: TaskPreview[];
  /** Approved tasks (review→done) awaiting deploy decision. 'full' keys only. */
  deploy_requests?: TaskPreview[];
  /** Tasks returned review→in_progress (rework needed). Any domain. */
  fix_requests?: TaskPreview[];
  waited_ms: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shape of task columns joined from task_column_history via tasks!inner(...). */
interface JoinedTaskColumns {
  id: string;
  title: string;
  column: string;
  assigned_to: string | null;
  reviewer_id: string | null;
  version: number;
  is_inbox: boolean;
  is_blocked: boolean;
  task_number: number | null;
  metadata: Record<string, unknown> | null;
}

function toPreview(t: JoinedTaskColumns, prefix: string): TaskPreview {
  return {
    id: t.id,
    title: t.title,
    column: t.column,
    assigned_to: t.assigned_to,
    reviewer_id: t.reviewer_id,
    version: t.version,
    is_inbox: t.is_inbox,
    is_blocked: t.is_blocked,
    full_id: `${prefix}-${t.task_number ?? 0}`,
    task_number: t.task_number ?? 0,
  };
}

/** Migration 051: reason of the last review→in_progress return, if any. */
function fixReasonOf(t: JoinedTaskColumns): string | undefined {
  const r = (t.metadata ?? {} as Record<string, unknown>).last_fix_reason;
  return typeof r === 'string' && r.length > 0 ? r : undefined;
}

/**
 * Migration 050: detect approved (review→done) and returned-for-rework
 * (review→in_progress) transitions on the caller's tasks within the wake
 * window, minus already-delivered ones. Delivers each transition exactly once
 * by inserting a marker event before returning it.
 */
async function detectApprovalWakes(
  supabase: SupabaseClient,
  workspaceId: string,
  agentName: string,
  workerId: string,
  includeDeploy: boolean
): Promise<{ deployRequests: TaskPreview[]; fixRequests: TaskPreview[] }> {
  const sinceIso = new Date(Date.now() - WAKE_WINDOW_MS).toISOString();

  const { data: histRows, error } = await supabase
    .from('task_column_history')
    .select(
      `id, moved_at, to_column,
       tasks!inner(id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, task_number, metadata)`
    )
    .eq('tasks.workspace_id', workspaceId)
    .eq('tasks.assigned_to', workerId)
    .eq('from_column', 'review')
    .in('to_column', ['done', 'in_progress'])
    .gte('moved_at', sinceIso)
    .order('moved_at', { ascending: false })
    .limit(100);

  if (error || !histRows || histRows.length === 0) {
    return { deployRequests: [], fixRequests: [] };
  }

  // Newest relevant transition per task per category; require the task to
  // still be in the target column (a later move supersedes the wake).
  const newestDeploy = new Map<
    string,
    { historyId: string; task: JoinedTaskColumns }
  >();
  const newestFix = new Map<
    string,
    { historyId: string; task: JoinedTaskColumns }
  >();
  for (const row of histRows as unknown as Array<{
    id: string;
    to_column: string;
    tasks: JoinedTaskColumns;
  }>) {
    const task = row.tasks;
    if (row.to_column === 'done') {
      if (task.column === 'done' && !newestDeploy.has(task.id)) {
        newestDeploy.set(task.id, { historyId: row.id, task });
      }
    } else if (row.to_column === 'in_progress') {
      if (task.column === 'in_progress' && !newestFix.has(task.id)) {
        newestFix.set(task.id, { historyId: row.id, task });
      }
    }
  }

  // Dedup against previously delivered markers (survives session restarts).
  const { data: markers } = await supabase
    .from('agent_events')
    .select('metadata')
    .eq('workspace_id', workspaceId)
    .eq('agent_name', agentName)
    .in('tool', ['deploy_notify', 'fix_notify'])
    .gte('created_at', sinceIso);

  const delivered = new Set<string>();
  for (const m of markers ?? []) {
    const hid = (m.metadata as { history_id?: string } | null)?.history_id;
    if (hid) delivered.add(hid);
  }

  const pendingDeploy = [...newestDeploy.values()].filter(
    (e) => !delivered.has(e.historyId)
  );
  const pendingFix = [...newestFix.values()].filter(
    (e) => !delivered.has(e.historyId)
  );
  if (pendingDeploy.length === 0 && pendingFix.length === 0) {
    return { deployRequests: [], fixRequests: [] };
  }

  // Resolve task_prefix once for full_id
  const { data: ws } = await supabase
    .from('workspaces')
    .select('task_prefix')
    .eq('id', workspaceId)
    .maybeSingle();
  const prefix = (ws?.task_prefix as string | null) ?? 'TASK';

  // Mark BEFORE returning (marker insert failure ⇒ at-least-once redelivery).
  const insertMarkers = async (
    entries: Array<{ historyId: string; task: JoinedTaskColumns }>,
    tool: 'deploy_notify' | 'fix_notify',
    summary: string
  ) => {
    for (const e of entries) {
      await supabase.from('agent_events').insert({
        workspace_id: workspaceId,
        tool,
        agent_name: agentName,
        task_id: e.task.id,
        summary,
        metadata: { history_id: e.historyId },
      });
    }
  };

  if (includeDeploy && pendingDeploy.length > 0) {
    await insertMarkers(pendingDeploy, 'deploy_notify', 'deploy_request_delivered');
  }
  if (pendingFix.length > 0) {
    await insertMarkers(pendingFix, 'fix_notify', 'fix_request_delivered');
  }

  return {
    deployRequests:
      includeDeploy && pendingDeploy.length > 0
        ? pendingDeploy.map((e) => toPreview(e.task, prefix))
        : [],
    fixRequests:
      pendingFix.length > 0
        ? pendingFix.map((e) => ({
            ...toPreview(e.task, prefix),
            ...(fixReasonOf(e.task) ? { fix_reason: fixReasonOf(e.task) } : {}),
          }))
        : [],
  };
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

  // Loop-guard breaker (client-side duty loop): validated, then ignored —
  // the server never uses the value.
  if (
    params.poll_seq !== undefined &&
    (typeof params.poll_seq !== 'number' || Number.isNaN(params.poll_seq))
  ) {
    throw invalidParams('poll_seq must be a number.');
  }

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

  // Migration 050: deploy wakes are meaningful only for keys allowed to deploy;
  // observer keys get neither list (read-only watchdog).
  const includeDeployWakes = key.autonomyLevel === 'full';
  const includeWakes = key.autonomyLevel !== 'observer';

  while (true) {
    // Re-resolve each iteration: INV-04 auto-create may run mid-wait
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', `agent::${agentName}`)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (worker) {
      const workerId = worker.id as string;
      const { data: rows, error } = await supabase
        .from('tasks')
        .select(
          'id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, task_number'
        )
        .eq('workspace_id', workspaceId)
        .eq('assigned_to', workerId)
        .neq('column', 'done')
        .order('created_at', { ascending: true })
        .limit(50);

      let freshPreviews: TaskPreview[] = [];
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

          freshPreviews = fresh.map((t) =>
            toPreview(t as unknown as JoinedTaskColumns, prefix)
          );
        }
      }

      let deployRequests: TaskPreview[] = [];
      let fixRequests: TaskPreview[] = [];
      if (includeWakes) {
        const wakes = await detectApprovalWakes(
          supabase,
          workspaceId,
          agentName,
          workerId,
          includeDeployWakes
        );
        deployRequests = wakes.deployRequests;
        fixRequests = wakes.fixRequests;
      }

      if (
        freshPreviews.length > 0 ||
        deployRequests.length > 0 ||
        fixRequests.length > 0
      ) {
        return {
          success: true,
          status: 'new_tasks',
          tasks: freshPreviews,
          ...(includeDeployWakes ? { deploy_requests: deployRequests } : {}),
          ...(includeWakes ? { fix_requests: fixRequests } : {}),
          waited_ms: timeoutSec * 1000 - (deadline - Date.now()),
        };
      }
    }

    if (Date.now() >= deadline) {
      return { success: true, status: 'timeout', tasks: [], waited_ms: timeoutSec * 1000 };
    }
    await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  }
}