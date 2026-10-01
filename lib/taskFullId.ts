/**
 * buildFullId — единственная точка сборки display-id (SUB-01).
 *
 * Живёт в корневом `lib/`, а не в `src/lib/realtime/tasks`, потому что его зовут
 * и клиентские пути (DataContext, mapTaskRow, Realtime), и серверное обогащение
 * (`lib/taskEnrichment.ts`) — а `realtime/tasks` тянет React-хук и на сервере
 * неуместен. `src/lib/realtime/tasks.ts` реэкспортирует эту функцию, поэтому
 * существующие импорты не меняются.
 *
 * Почему нельзя просто «префикс + task_number» (как было до SUB-01): у подзадачи
 * `task_number = NULL`, номер производный от родителя. Старая формула уводила
 * подзадачу в `id.slice(0, 8)` — в UI появлялось «Подзадача 8a35e04c».
 *
 * Формат подзадачи — «ONI-42-SUB-1», ровно как у серверного RPC
 * `task_full_id` (миграция 139), который уже отдаёт такой id в Telegram-карточке.
 * Без номера родителя получается «ONI-SUB-1»: он не совпал бы с карточкой в
 * боте, и `find_task_by_full_id` такой id не разобрал бы.
 */

import type { TaskEntity } from '../src/types/flowboard';

/**
 * Номер задачи-родителя по её id — для сборки display-id подзадачи.
 *
 * У подзадачи `task_number = NULL` (миг. 139), а идентификатор производный —
 * `ONI-41-SUB-1`. Без номера родителя `buildFullId` даёт `ONI-SUB-1`, и
 * Realtime-событие подзадачи перезатирало бы правильный id, пришедший из API,
 * сломанным: в стриме и в шапке шторки появлялось «Подзадача ONIT-SUB-1».
 *
 * Родитель всегда есть в `known` (там лежат все задачи воркспейса), поэтому
 * ходить в БД на каждое событие не нужно.
 *
 * `undefined` — родитель неизвестен вызывающему (не передан `known` или строки
 * нет): buildFullId тогда ведёт себя как раньше. `null` — родитель известен, но
 * номера у него нет.
 */
export function parentTaskNumberFor(
  raw: { id: string; parent_task_id?: string | null } | null | undefined,
  known: TaskEntity[] | null | undefined,
): number | null | undefined {
  const parentId = raw?.parent_task_id;
  if (!parentId || !known) return undefined;
  return known.find((t) => t.id === parentId)?.task_number ?? null;
}

export function buildFullId(
  prefix: string | null | undefined,
  taskNumber: number | null | undefined,
  fallbackId: string,
  subtaskIndex?: number | null,
  parentTaskNumber?: number | null,
): string {
  if (prefix && subtaskIndex != null) {
    return parentTaskNumber
      ? `${prefix}-${parentTaskNumber}-SUB-${subtaskIndex}`
      : `${prefix}-SUB-${subtaskIndex}`;
  }
  if (prefix && taskNumber) return `${prefix}-${taskNumber}`;
  return fallbackId.slice(0, 8);
}
