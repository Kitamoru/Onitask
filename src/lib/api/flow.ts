/**
 * Flow Board API client.
 * 
 * Provides functions to fetch tasks, flow metrics, and update tasks.
 * Now uses server-side API routes (with service_role key) instead of 
 * direct Supabase client queries (which fail due to RLS).
 * 
 * Based on: docs/onitask_flow_.md §9–10, TASKS.md Stage 4 FLOW-01, FLOW-08
 */

import type {
  TaskEntity,
  PatchTaskRequest,
  PatchTaskResponse,
  FlowMetricsResponse,
} from '@/types/flowboard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get Telegram initData from window for API auth */
function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** Convert DB task row to our TaskEntity */
function mapTaskRow(row: any): TaskEntity {
  const fullId = row.task_number ? `TASK-${row.task_number}` : row.id.slice(0, 8);
  
  return {
    id: row.id,
    full_id: fullId,
    workspace_prefix: 'TASK',
    task_number: row.task_number ?? 0,
    title: row.title,
    description: row.description,
    tags: row.tags ?? [],
    ai_hint: null,
    column: row.column,
    priority: row.priority,
    deadline: row.deadline,
    deadline_urgency: row.deadline_urgency ?? null,
    is_inbox: row.is_inbox,
    is_blocked: row.is_blocked,
    needs_human: row.needs_human,
    escalation_reason: row.escalation_reason ?? null,
    assigned_to: row.assigned_to,
    reviewer_id: row.reviewer_id,
    handoff_to: row.handoff_to ?? null,
    handoff_notes: row.handoff_notes ?? null,
    sprint_id: row.sprint_id,
    story_points: null,
    cognitive_weight: row.cognitive_weight,
    raw_input: row.raw_input ?? null,
    clarity_score: row.clarity_score ?? null,
    complexity: row.complexity ?? null,
    enrichment_strategy: row.enrichment_strategy ?? null,
    version: row.version,
    position: row.position,
    source: row.source ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    moved_to_column_at: row.moved_to_column_at ?? null,
  };
}

/**
 * GET /api/tasks — Fetch all tasks for current workspace.
 * Uses server-side API with Telegram initData auth.
 */
export async function getTasks(): Promise<{ tasks: TaskEntity[]; error: string | null }> {
  try {
    const initData = getTelegramInitData();
    if (!initData) {
      return { tasks: [], error: 'Не авторизован' };
    }

    const res = await fetch('/api/tasks', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-init-data': initData,
      },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      return { tasks: [], error: errData.error || 'Failed to load tasks' };
    }

    const json = await res.json();
    const tasks = (json.tasks ?? []).map(mapTaskRow);
    return { tasks, error: null };
  } catch (err) {
    return { tasks: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * PATCH /api/tasks/:id — Update a single task.
 * Uses fetch to server-side API.
 */
export async function patchTask(
  taskId: string,
  payload: PatchTaskRequest,
): Promise<PatchTaskResponse> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, init_data: initData }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { task: {} as TaskEntity, warning: json.error || 'Update failed' };
    }

    return { task: mapTaskRow(json.task), unblocked_ids: [] };
  } catch (err) {
    return {
      task: {} as TaskEntity,
      warning: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * POST /api/tasks — Create a new task.
 * Uses fetch to server-side API.
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
    const initData = getTelegramInitData();

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, init_data: initData }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { task: null, error: json.error || 'Create failed' };
    }

    return { task: mapTaskRow(json.task), error: null };
  } catch (err) {
    return { task: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Flow Metrics ────────────────────────────────────────────────────────────

/**
 * POST /api/flow/metrics — Aggregate flow metrics.
 * Uses server-side API with Telegram initData auth.
 */
export async function getFlowMetrics(): Promise<{
  metrics: FlowMetricsResponse;
  error: string | null;
}> {
  try {
    const initData = getTelegramInitData();
    if (!initData) {
      return {
        metrics: {
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          cached_at: new Date().toISOString(),
          cache_ttl: { columns: 5, workers: 60, alerts: 60 },
        },
        error: 'Не авторизован',
      };
    }

    const res = await fetch('/api/flow/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      return {
        metrics: {
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          cached_at: new Date().toISOString(),
          cache_ttl: { columns: 5, workers: 60, alerts: 60 },
        },
        error: errData.error || 'Failed to load metrics',
      };
    }

    const json = await res.json();
    if (!json.success) {
      return {
        metrics: {
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          cached_at: new Date().toISOString(),
          cache_ttl: { columns: 5, workers: 60, alerts: 60 },
        },
        error: json.error || 'Unknown error',
      };
    }

    return { metrics: json.data, error: null };
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