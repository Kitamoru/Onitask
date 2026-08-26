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
const MAX_TIMEOUT_SEC = 45; // stays safely under Cline's 120s MCP client timeout
const MAX_KNOWN_IDS = 200;
const WAKE_WINDOW_MS = 24 * 60 * 60 * 1000; // approval/fix detection window

// --- CTX-01: wall-clock safety + server-side duty state ----------------------
// Never START another DB-polling iteration with less than this left before the
// deadline: guarantees the response always makes it back under the MCP client
// request timeout even if the last round-trips degrade.
const MIN_ITERATION_BUDGET_MS = 3000;
/**
 * CTX-01a two-phase delivery. DELIVERED = soft suppression only: if the agent
 * never ACKs a delivered task (crash, busy elsewhere, lost batch), it is
 * re-delivered after this TTL — restoring the pre-CTX-01 semantics where an
 * unprocessed task woke the agent again on its very next poll.
 */
const DELIVERED_TTL_MS = 10 * 60 * 1000;
/** ACKed (processed) tasks are suppressed long-term. */
const ACKED_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap of remembered ids per agent+workspace. */
const SEEN_MAX = 500;
/** Abandoned duty states older than this are garbage-collected on load. */
const DUTY_STATE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface WaitForTasksParams extends DomainContext {
  /**
   * CTX-01a: ACK delta — ids of tasks PROCESSED since the previous call
   * (just the delta, not the full history). Anything delivered but never
   * acked is re-delivered automatically after DELIVERED_TTL_MS. Legacy
   * clients passing the whole history degrade gracefully (all become acks).
   */
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

/**
 * CTX-01/01a (migration 056): server-side duty-loop memory.
 *
 * Keyed by the authenticated agent identity (workspace_id + agent_name from
 * the Bearer key), so no session identifier ever travels through the LLM
 * context: after an Auto Compact the next bare wait_for_tasks call finds the
 * same state.
 *
 * Two entry kinds (two-phase delivery):
 *   - delivered ({id, ts})       — soft suppression, expires in
 *                                  DELIVERED_TTL_MS; an un-acked task wakes
 *                                  the agent again.
 *   - acked     ({id, ts, k:1})  — hard suppression for ACKED_TTL_MS; set
 *                                  when the client echoes processed ids back.
 */
interface DutySeenEntry {
  id: string;
  ts: number;
  /** Present ⇒ acked (processed by the client); absent ⇒ merely delivered. */
  k?: number;
}

interface DutyState {
  acked: Map<string, number>;
  delivered: Map<string, number>;
}

async function loadDutyState(
  supabase: SupabaseClient,
  workspaceId: string,
  agentName: string
): Promise<DutyState> {
  const state: DutyState = { acked: new Map(), delivered: new Map() };
  const now = Date.now();

  const { data } = await supabase
    .from('agent_duty_state')
    .select('seen')
    .eq('workspace_id', workspaceId)
    .eq('agent_name', agentName)
    .maybeSingle();

  for (const e of (data?.seen as DutySeenEntry[] | null) ?? []) {
    if (!e || typeof e.id !== 'string' || typeof e.ts !== 'number') continue;
    if (e.k === 1) {
      if (now - e.ts < ACKED_TTL_MS) state.acked.set(e.id, e.ts);
    } else if (now - e.ts < DELIVERED_TTL_MS) {
      state.delivered.set(e.id, e.ts);
    }
  }

  // Opportunistic GC: drop states abandoned more than DUTY_STATE_STALE_MS ago.
  await supabase
    .from('agent_duty_state')
    .delete()
    .lt('updated_at', new Date(now - DUTY_STATE_STALE_MS).toISOString());

  return state;
}

/** Persist-before-return: failure ⇒ at-least-once redelivery (marker semantics). */
async function persistDutyState(
  supabase: SupabaseClient,
  workspaceId: string,
  agentName: string,
  state: DutyState
): Promise<void> {
  const now = Date.now();
  const entries: DutySeenEntry[] = [
    ...[...state.acked.entries()]
      .filter(([, ts]) => now - ts < ACKED_TTL_MS)
      .map(([id, ts]) => ({ id, ts, k: 1 })),
    ...[...state.delivered.entries()]
      .filter(([, ts]) => now - ts < DELIVERED_TTL_MS)
      .map(([id, ts]) => ({ id, ts })),
  ].slice(-SEEN_MAX);

  await supabase.from('agent_duty_state').upsert(
    {
      workspace_id: workspaceId,
      agent_name: agentName,
      seen: entries,
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: 'workspace_id,agent_name' }
  );
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

  // CTX-01a: load the agent's server-side duty state ONCE per call (not per
  // poll iteration). Two phases: DELIVERED (soft suppression — an un-acked
  // task re-wakes the agent after DELIVERED_TTL_MS) and ACKED (the client
  // echoed processed ids back — hard suppression). The payload stays
  // constant-sized: the client echoes only what it processed since last call.
  const duty = await loadDutyState(supabase, workspaceId, agentName);

  // Explicit known_task_ids = ACK delta. Legacy clients passing their entire
  // history degrade gracefully: every id simply becomes an ack.
  if (knownIds.length > 0) {
    const now = Date.now();
    let changed = false;
    for (const id of knownIds) {
      if (!duty.acked.has(id)) changed = true;
      duty.acked.set(id, now);
      duty.delivered.delete(id);
    }
    if (changed) {
      await persistDutyState(supabase, workspaceId, agentName, duty);
    }
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
        const fresh = rows.filter(
          (t) =>
            !duty.acked.has(t.id as string) &&
            !duty.delivered.has(t.id as string)
        );
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
        // CTX-01a: mark freshly delivered tasks as DELIVERED (SOFT
        // suppression) BEFORE returning — persist-first ⇒ at-least-once on
        // failure. If the client never acks them, they re-wake after
        // DELIVERED_TTL_MS instead of being lost until a long timeout.
        if (freshPreviews.length > 0) {
          const now = Date.now();
          for (const t of freshPreviews) duty.delivered.set(t.id, now);
          await persistDutyState(supabase, workspaceId, agentName, duty);
        }
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

    // Wall-clock guard: stop polling while there is still enough budget to
    // return before the MCP client's request timeout even if the final DB
    // round-trips degrade.
    if (deadline - Date.now() <= MIN_ITERATION_BUDGET_MS) {
      return { success: true, status: 'timeout', tasks: [], waited_ms: timeoutSec * 1000 };
    }
    await sleep(
      Math.min(POLL_INTERVAL_MS, deadline - MIN_ITERATION_BUDGET_MS - Date.now())
    );
  }
}