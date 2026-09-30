/**
 * SUB-01: клиент для подзадач (`/api/tasks/[id]/subtasks`).
 *
 * Отдельный модуль рядом с `taskRelations.ts` — тот же паттерн: тонкая обёртка
 * над Route Handler, без кеша и оптимистичных обновлений. Источником истины
 * остаётся `DataContext` (Realtime сам доставит INSERT новой подзадачи), а этот
 * слой только мутирует.
 *
 * Auth — заголовок `x-init-data`, как во всех соседних маршрутах TWA.
 */

import type { TaskEntity } from '@/types/flowboard';

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
    throw new Error(
      (json as { error?: string }).error || 'Не удалось выполнить операцию',
    );
  }
  return json as T;
}

export interface SubtasksResponse {
  subtasks: TaskEntity[];
}

export interface CreateSubtaskResponse {
  subtask: TaskEntity;
}

export interface CreateSubtaskInput {
  /** Содержание подзадачи. Пустое значение отсекается сервером (400). */
  title: string;
  /** workers.id исполнителя; null — без исполнителя. Сервер отклонит агента. */
  assigned_to?: string | null;
  /** ISO-строка срока; невалидная дата сохранится как null. */
  deadline?: string | null;
}

export async function getSubtasks(taskId: string): Promise<SubtasksResponse> {
  const response = await requestJson<SubtasksResponse>(
    `/api/tasks/${taskId}/subtasks`,
    {
      method: 'GET',
      headers: { 'x-init-data': getTelegramInitData() },
      cache: 'no-store',
    },
  );
  return { subtasks: response.subtasks ?? [] };
}

export async function createSubtask(
  taskId: string,
  input: CreateSubtaskInput,
): Promise<CreateSubtaskResponse> {
  return requestJson<CreateSubtaskResponse>(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-init-data': getTelegramInitData(),
    },
    body: JSON.stringify({
      title: input.title,
      assigned_to: input.assigned_to ?? null,
      deadline: input.deadline ?? null,
    }),
  });
}
