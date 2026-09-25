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
  LatestTaskSubmission,
  SubmitTaskRequest,
  SubmitTaskResponse,
  ReviewActionRequest,
  ReviewActionResponse,
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
  // Use server-computed full_id/workspace_prefix if available, otherwise fallback
  const fullId = row.full_id ?? (row.task_number ? `${row.workspace_prefix ?? 'TASK'}-${row.task_number}` : row.id.slice(0, 8));
  const prefix = row.workspace_prefix ?? (fullId.includes('-') ? fullId.split('-')[0] : 'TASK');
  
  return {
    id: row.id,
    full_id: fullId,
    workspace_prefix: prefix,
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
    story_points: row.story_points ?? null,
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
    created_by: row.created_by ?? null,
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
 * DELETE /api/tasks/:id — Delete a task with cascade cleanup.
 */
export async function deleteTask(
  taskId: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Delete failed' };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * POST /api/workers/:workerId/revoke — Revoke a worker's access to the board.
 */
export async function revokeWorkerAccess(
  workerId: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/workers/${workerId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Revoke failed' };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * PATCH /api/workers/:workerId/access — Save access preset and/or role title
 * (вкладка «Доступы» боттом-шита воркера).
 *
 * @param body.preset      — пресет доступов: 'admin' | 'member' (owner не выдаётся)
 * @param body.role_title  — кастомная «Роль в доске» (строка ≤ 50 симв. или null)
 */
export async function saveWorkerAccess(
  workerId: string,
  body: { preset?: 'admin' | 'member'; role_title?: string | null },
): Promise<{ success: boolean; error: string | null }> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/workers/${workerId}/access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData, ...body }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Save failed' };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * POST /api/workspaces/:id/transfer-ownership — передать владение доской
 * другому активному участнику (только текущий владелец).
 *
 * @param toWorkerId — UUID воркера-преемника (active human этой доски)
 */
export async function transferWorkspaceOwnership(
  workspaceId: string,
  toWorkerId: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/workspaces/${workspaceId}/transfer-ownership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData, to_worker_id: toWorkerId }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Transfer failed' };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * POST /api/workspaces/:id/leave — покинуть доску (self-leave).
 * Владелец должен сначала передать владение (409 owner_must_transfer_first).
 */
export async function leaveWorkspace(
  workspaceId: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/workspaces/${workspaceId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Leave failed' };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Attachments (FILE-05) ──────────────────────────────────────────────────

export interface TaskAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  author_type?: string;
  source?: string;
}

/**
 * GET /api/tasks/:id/attachments — манифест файлов задачи (без signed URL).
 * Throwing-контракт для useQuery: ошибка сети/сервера — исключение.
 */
export async function getTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const initData = getTelegramInitData();
  const res = await fetch(`/api/tasks/${taskId}/attachments`, {
    method: 'GET',
    headers: { 'x-init-data': initData },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Не удалось загрузить файлы');
  }
  return json.attachments ?? [];
}

/**
 * POST /api/tasks/:id/attachments/:attachmentId — подписать download-URL
 * по требованию (on-demand). URL свежий при каждом клике — никогда не протухает.
 * Бросает исключение при ошибке (useMutation-совместимо).
 */
export async function signTaskAttachment(
  taskId: string,
  attachmentId: string,
): Promise<string> {
  const initData = getTelegramInitData();
  const res = await fetch(`/api/tasks/${taskId}/attachments/${attachmentId}`, {
    method: 'POST',
    headers: { 'x-init-data': initData },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Не удалось открыть файл');
  }
  return json.url as string;
}

/** POST /api/tasks/:id/attachments — загрузка файлов (multipart). */
export async function uploadTaskAttachments(
  taskId: string,
  files: File[],
): Promise<{ attachments: TaskAttachment[]; error: string | null }> {
  try {
    const initData = getTelegramInitData();
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    formData.append('init_data', initData);

    const res = await fetch(`/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: { 'x-init-data': initData },
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) {
      return { attachments: [], error: json.error || 'Upload failed' };
    }
    return { attachments: json.attachments ?? [], error: null };
  } catch (err) {
    return { attachments: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * SUBMIT-01: GET /api/tasks/:id/submissions — последняя сдача задачи
 * (префилл формы «Результат» при review→done).
 */
export async function getLatestTaskSubmission(
  taskId: string,
): Promise<{ submission: LatestTaskSubmission | null; error: string | null }> {
  try {
    const initData = getTelegramInitData();
    const res = await fetch(`/api/tasks/${taskId}/submissions`, {
      method: 'GET',
      headers: { 'x-init-data': initData },
    });
    const json = await res.json();
    if (!res.ok) {
      return { submission: null, error: json.error || 'Failed to load submission' };
    }
    return { submission: (json.submission ?? null) as LatestTaskSubmission | null, error: null };
  } catch (err) {
    return {
      submission: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * SUBMIT-01: POST /api/tasks/:id/submit — сдача задачи.
 * Сервер атомарно создаёт submission (с привязкой файлов) и двигает задачу.
 */
export async function submitTask(
  taskId: string,
  payload: SubmitTaskRequest,
): Promise<SubmitTaskResponse | { error: string }> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/tasks/${taskId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-init-data': initData },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      return { error: json.error || 'Submit failed' };
    }
    return json as SubmitTaskResponse;
  } catch (err) {
        return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * REV-01: POST /api/tasks/:id/review — ревью-решение (approve/fix).
 * Атомарно через RPC review_action (мг. 083).
 */
export async function reviewTask(
  taskId: string,
  payload: ReviewActionRequest,
): Promise<ReviewActionResponse | { error: string }> {
  const initData = getTelegramInitData();

  const res = await fetch(`/api/tasks/${taskId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-init-data': initData },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) {
    return { error: json.error || 'Review failed' };
  }
  return json as ReviewActionResponse;
}

/** DELETE /api/tasks/:id/attachments/:attachmentId — удалить файл задачи. */
export async function deleteTaskAttachment(
  taskId: string,
  attachmentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const initData = getTelegramInitData();
    const res = await fetch(`/api/tasks/${taskId}/attachments/${attachmentId}`, {
      method: 'DELETE',
      headers: { 'x-init-data': initData },
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Delete failed' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
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
  metadata?: Record<string, unknown>;
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
 * 
 * @param workspaceId - Optional override for which workspace's metrics to fetch.
 *   If not provided, uses the user's primary workspace from auth context.
 */
export async function getFlowMetrics(workspaceId?: string): Promise<{
  metrics: FlowMetricsResponse;
  error: string | null;
}> {
  try {
    const initData = getTelegramInitData();
    if (!initData) {
      return {
        metrics: {
          evaluation: { storyPointsEnabled: false, cognitiveWeightEnabled: false, storyPointValues: [1, 2, 3, 5, 8], hoursPerSp: {} },
          sprintEnabled: false,
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          risk: { people: 0, processes: 0, escalations: 0 },
          riskBreakdown: { people: [], processes: { reviewBacklog: [], stuck: [], orphanBlockers: [] }, escalations: [] },
          cached_at: new Date().toISOString(),
          cache_ttl: { columns: 5, workers: 60, alerts: 60 },
        },
        error: 'Не авторизован',
      };
    }

    const res = await fetch('/api/flow/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        init_data: initData,
        ...(workspaceId && { workspace_id: workspaceId }),
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      return {
        metrics: {
          evaluation: { storyPointsEnabled: false, cognitiveWeightEnabled: false, storyPointValues: [1, 2, 3, 5, 8], hoursPerSp: {} },
          sprintEnabled: false,
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          risk: { people: 0, processes: 0, escalations: 0 },
          riskBreakdown: { people: [], processes: { reviewBacklog: [], stuck: [], orphanBlockers: [] }, escalations: [] },
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
          evaluation: { storyPointsEnabled: false, cognitiveWeightEnabled: false, storyPointValues: [1, 2, 3, 5, 8], hoursPerSp: {} },
          sprintEnabled: false,
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          risk: { people: 0, processes: 0, escalations: 0 },
          riskBreakdown: { people: [], processes: { reviewBacklog: [], stuck: [], orphanBlockers: [] }, escalations: [] },
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
        evaluation: { storyPointsEnabled: false, cognitiveWeightEnabled: false, storyPointValues: [1, 2, 3, 5, 8], hoursPerSp: {} },
        sprintEnabled: false,
        sprint: null,
        columns: [],
        workers: [],
        alerts: [],
        risk: { people: 0, processes: 0, escalations: 0 },
        riskBreakdown: { people: [], processes: { reviewBacklog: [], stuck: [], orphanBlockers: [] }, escalations: [] },
        cached_at: new Date().toISOString(),
        cache_ttl: { columns: 5, workers: 60, alerts: 60 },
      },
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
