import type {
  CreateTaskRelationResponse,
  DeleteTaskRelationResponse,
  TaskRelationDirection,
  TaskRelationsResponse,
} from '@/types/taskRelations';

function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json as { error?: string }).error || 'Не удалось выполнить операцию');
  }
  return json as T;
}

export async function getTaskRelations(taskId: string): Promise<TaskRelationsResponse> {
  const response = await requestJson<TaskRelationsResponse>(
    `/api/tasks/${taskId}/relations`,
    {
      method: 'GET',
      headers: { 'x-init-data': getTelegramInitData() },
      cache: 'no-store',
    },
  );
  return {
    blockers: response.blockers ?? [],
    downstream: response.downstream ?? [],
  };
}

export async function createTaskRelation(
  taskId: string,
  relatedTaskId: string,
  direction: TaskRelationDirection,
): Promise<CreateTaskRelationResponse> {
  return requestJson<CreateTaskRelationResponse>(`/api/tasks/${taskId}/relations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-init-data': getTelegramInitData(),
    },
    body: JSON.stringify({ related_task_id: relatedTaskId, direction }),
  });
}

export async function deleteTaskRelation(
  taskId: string,
  relationId: string,
): Promise<DeleteTaskRelationResponse> {
  return requestJson<DeleteTaskRelationResponse>(
    `/api/tasks/${taskId}/relations/${relationId}`,
    {
      method: 'DELETE',
      headers: { 'x-init-data': getTelegramInitData() },
    },
  );
}
