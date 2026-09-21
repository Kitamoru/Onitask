/**
 * STREAM-01: персональный фильтр задач для Stream (лента «Стрим задач»).
 *
 * Вынесен в чистый модуль (без UI- и DB-зависимостей) чтобы unit-тестировать
 * бизнес-правило «какие задачи видит пользователь в stream» в node-env (vitest).
 *
 * Правило (согласовано 2026-09-21): задача показывается пользователю в stream,
 * если она создана им, назначена ему, назначена ему на проверку (reviewer)
 * или передана ему (handoff). Остальные задачи доски — только во flowboard
 * (в т.ч. для owner/admin — исключений нет).
 */
import type { TaskEntity } from '@/types/flowboard';

export type StreamVisibleTask = Pick<
  TaskEntity,
  'assigned_to' | 'created_by' | 'reviewer_id' | 'handoff_to'
>;

export function filterTasksForUser<T extends StreamVisibleTask>(
  tasks: T[],
  currentUserId: string | null | undefined,
): T[] {
  // Пользователь ещё не загрузился (boot-фаза) — не фильтруем, чтобы не
  // показывать пустой stream во время загрузки.
  if (!currentUserId) return tasks;
  return tasks.filter(
    (t) =>
      t.assigned_to === currentUserId ||
      t.created_by === currentUserId ||
      t.reviewer_id === currentUserId ||
      t.handoff_to === currentUserId,
  );
}