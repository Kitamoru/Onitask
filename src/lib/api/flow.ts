/**
 * Flow Board API client.
 * 
 * Provides functions to fetch tasks, flow metrics, and update tasks.
 * Uses Supabase browser client for client-side operations.
 * 
 * Based on: docs/onitask_flow_.md §9–10, TASKS.md Stage 4 FLOW-01, FLOW-08
 */

import { createBrowserClient } from '../../../lib/supabase';
import type { Database } from '../../../types/supabase';
import type {
  TaskEntity,
  PatchTaskRequest,
  PatchTaskResponse,
  FlowMetricsResponse,
  ColumnHealthData,
  WorkerMetricData,
  AlertData,
  SprintInfo,
} from '@/types/flowboard';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type WorkersRow = Database['public']['Tables']['workers']['Row'];
type SprintsRow = Database['public']['Tables']['sprints']['Row'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get current workspace ID from session */
async function getCurrentWorkspaceId(): Promise<string | null> {
  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: workers } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', user.id)
    .eq('is_active', true)
    .limit(1);

  return workers?.[0]?.workspace_id ?? null;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** Convert DB task row to our TaskEntity */
function mapTaskRow(row: TasksRow): TaskEntity {
  // Compute full_id from workspace prefix + task_number
  // Note: workspace_prefix is not stored directly, we derive from task_number pattern
  const fullId = row.task_number ? `TASK-${row.task_number}` : row.id.slice(0, 8);
  
  return {
    id: row.id,
    full_id: fullId,
    workspace_prefix: 'TASK', // placeholder - would need workspace lookup
    task_number: row.task_number ?? 0,
    title: row.title,
    description: row.description,
    ai_hint: null, // would come from task_enrichments
    column: row.column,
    assigned_to: row.assigned_to,
    reviewer_id: row.reviewer_id,
    priority: row.priority,
    story_points: null, // would come from task_enrichments
    cognitive_weight: row.cognitive_weight,
    deadline: row.deadline,
    is_blocked: row.is_blocked,
    needs_human: row.needs_human,
    sprint_id: row.sprint_id,
    is_inbox: row.is_inbox,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    moved_to_column_at: row.moved_to_column_at,
  };
}

/**
 * GET /api/tasks — Fetch all tasks for current workspace.
 * Returns tasks sorted by updated_at DESC.
 */
export async function getTasks(): Promise<{ tasks: TaskEntity[]; error: string | null }> {
  try {
    const workspaceId = await getCurrentWorkspaceId();
    if (!workspaceId) {
      return { tasks: [], error: 'Не авторизован' };
    }

    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_inbox', false)
      .order('updated_at', { ascending: false });

    if (error) {
      return { tasks: [], error: error.message };
    }

    return { tasks: ((data ?? []) as TasksRow[]).map(mapTaskRow), error: null };
  } catch (err) {
    return { tasks: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * PATCH /api/tasks/:id — Update a single task.
 * Implements last-write-wins without version check (per INV-09 note).
 */
export async function patchTask(
  taskId: string,
  payload: PatchTaskRequest,
): Promise<PatchTaskResponse> {
  try {
    const supabase = createBrowserClient();

    // Build update object with only defined values
    const update: Partial<TasksRow> = {};
    if (payload.column !== undefined) update.column = payload.column;
    if (payload.assigned_to !== undefined) update.assigned_to = payload.assigned_to;
    if (payload.reviewer_id !== undefined) update.reviewer_id = payload.reviewer_id;
    if (payload.priority !== undefined) update.priority = payload.priority;
    if (payload.cognitive_weight !== undefined) update.cognitive_weight = payload.cognitive_weight;
    if (payload.deadline !== undefined) update.deadline = payload.deadline;
    if (payload.title !== undefined) update.title = payload.title;
    if (payload.description !== undefined) update.description = payload.description;
    if (payload.clear_blocked) update.is_blocked = false;

    // Increment version
    const { data: currentTask } = await supabase
      .from('tasks')
      .select('version')
      .eq('id', taskId)
      .single();

    if (currentTask) {
      update.version = (currentTask as { version: number }).version + 1;
    }

    // Remove undefined values
    const cleanUpdate = Object.fromEntries(
      Object.entries(update).filter(([, v]) => v !== undefined)
    ) as Partial<TasksRow>;

    const { data, error } = await supabase
      .from('tasks')
      .update(cleanUpdate)
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      return {
        task: {} as TaskEntity,
        warning: error.message,
      };
    }

    return { task: mapTaskRow(data as TasksRow), unblocked_ids: [] };
  } catch (err) {
    return {
      task: {} as TaskEntity,
      warning: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * POST /api/tasks — Create a new task.
 */
export async function createTask(payload: {
  title: string;
  description?: string;
  column?: string;
  priority?: string;
  story_points?: number;
  cognitive_weight?: number;
  deadline?: string;
}): Promise<{ task: TaskEntity | null; error: string | null }> {
  try {
    const workspaceId = await getCurrentWorkspaceId();
    if (!workspaceId) {
      return { task: null, error: 'Не авторизован' };
    }

    const supabase = createBrowserClient();
    const insertPayload: Database['public']['Tables']['tasks']['Insert'] = {
      workspace_id: workspaceId,
      title: payload.title,
      description: payload.description ?? null,
      column: payload.column ?? 'backlog',
      priority: payload.priority ?? 'medium',
      cognitive_weight: payload.cognitive_weight ?? 1,
      deadline: payload.deadline ?? null,
      is_inbox: false,
      is_blocked: false,
      needs_human: false,
      version: 1,
    };
    const { data, error } = await supabase
      .from('tasks')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return { task: null, error: error.message };
    }

    return { task: mapTaskRow(data as TasksRow), error: null };
  } catch (err) {
    return { task: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Flow Metrics ────────────────────────────────────────────────────────────

/**
 * GET /api/flow/metrics — Aggregate flow metrics.
 * For Stage 4, queries database directly instead of Edge Function.
 * 
 * TTL strategy (per flow_.md §10):
 *   - Columns: 5 seconds
 *   - Workers: 60 seconds
 *   - Alerts: 60 seconds
 */
export async function getFlowMetrics(): Promise<{
  metrics: FlowMetricsResponse;
  error: string | null;
}> {
  try {
    const workspaceId = await getCurrentWorkspaceId();
    if (!workspaceId) {
      return {
        metrics: {
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          cached_at: new Date().toISOString(),
          cache_ttl: { columns: 5, workers: 60, alerts: 60 },
        },
        error: null,
      };
    }

    const supabase = createBrowserClient();

    // 1. Sprint info
    const { data: sprintData, error: sprintError } = await supabase
      .from('sprints')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'planning'])
      .order('created_at', { ascending: false })
      .limit(1);

    let sprint: SprintInfo | null = null;
    if (!sprintError && sprintData && (sprintData as SprintsRow[]).length > 0) {
      const sp = (sprintData as SprintsRow[])[0];
      sprint = {
        id: sp.id,
        name: sp.name || '',
        topic: '',
        startDate: sp.start_date || '',
        endDate: sp.end_date || '',
        daysElapsed: 0,
        totalDays: 7,
        progress: 0,
        doneSP: 0,
        totalSP: sp.capacity ?? 0,
        inProgress: 0,
        onReview: 0,
        isActive: sp.status === 'active',
      };
    }

    // 2. Column health (WIP counts)
    const { data: columnCounts, error: colErr } = await supabase
      .from('tasks')
      .select('column')
      .eq('workspace_id', workspaceId)
      .eq('is_inbox', false);

    const columnMap: Record<string, number> = { backlog: 0, in_progress: 0, review: 0, done: 0 };
    ((columnCounts ?? []) as TasksRow[]).forEach((t) => {
      if (columnMap.hasOwnProperty(t.column)) {
        columnMap[t.column]++;
      }
    });

    // WIP limits defaults
    const wipLimits: Record<string, number | null> = {
      backlog: 15,
      in_progress: 5,
      review: 4,
      done: null,
    };

    const columns: ColumnHealthData[] = Object.entries(columnMap).map(([name, wip_current]) => {
      const wip_limit = wipLimits[name] ?? null;
      let health: 'green' | 'yellow' | 'red' = 'green';
      if (wip_limit !== null && wip_current > wip_limit) {
        health = 'red';
      } else if (wip_limit !== null && wip_current >= wip_limit * 0.8) {
        health = 'yellow';
      }
      return {
        name,
        wip_current,
        wip_limit,
        health,
        avg_cycle_time_hours: null,
      };
    });

    // Count in_progress and onReview for sprint
    if (sprint) {
      sprint.inProgress = columnMap.in_progress;
      sprint.onReview = columnMap.review;
    }

    // 3. Worker load
    const { data: workersData, error: workersErr } = await supabase
      .from('workers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    const overloadThreshold = 6;
    const workersMetrics: WorkerMetricData[] = (((workersData ?? []) as WorkersRow[]) || []).map((w) => {
      const cognitive_load = w.type === 'human' ? Math.min(3, 1) : 0;

      return {
        display_name: w.display_name || w.id.slice(0, 8),
        type: w.type as 'human' | 'agent',
        cognitive_load,
        overload_threshold: overloadThreshold,
        status: cognitive_load >= 3 ? 'overloaded' : 'ok',
        throughput: w.type === 'agent' ? 1.2 : undefined,
        pending_escalations: undefined,
      };
    });

    // 4. Alerts
    const alerts: AlertData[] = [];

    for (const wm of workersMetrics) {
      if (wm.status === 'overloaded') {
        alerts.push({
          type: 'overloaded_member',
          severity: 'high',
          message: `${wm.display_name} перегружен: ${wm.cognitive_load} / ${wm.overload_threshold}`,
        });
      }
    }

    for (const col of columns) {
      if (col.health === 'red') {
        alerts.push({
          type: 'bottleneck',
          severity: 'high',
          message: `Колонка "${col.name}" перегружена: ${col.wip_current} задач при лимите ${col.wip_limit}`,
          column: col.name,
        });
      }
    }

    return {
      metrics: {
        sprint,
        columns,
        workers: workersMetrics,
        alerts,
        cached_at: new Date().toISOString(),
        cache_ttl: { columns: 5, workers: 60, alerts: 60 },
      },
      error: null,
    };
  } catch (err) {
    return {
      metrics: {
        sprint: null,
        columns: [],
        workers: [],
        alerts: [],
        cached_at: new Date().toISOString(),
        cache_ttl: { columns: 5, workers: 60, alerts: 60 },
      },
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}