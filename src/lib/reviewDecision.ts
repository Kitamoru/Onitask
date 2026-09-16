/**
 * REV-01 / SUBMIT-01: модель прав для review-решения и сдачи.
 *
 * Вынесена отдельно (без UI- и DB-зависимостей) чтобы unit-тестировать
 * бизнес-правило «кто может решать» в node-env (vitest) без jsdom/RTL.
 */
import type { TaskEntity } from '@/types/flowboard';

export type ReviewActorRole = 'owner' | 'admin' | 'reviewer' | 'executor' | string;

/**
 * Кто может решать задачу в колонке review (паттерн, согласованный 2026-09-13):
 *   - назначенный reviewer (task.reviewer_id);
 *   - creator (task.created_by), если reviewer НЕ назначен (backfill);
 *   - owner/admin всегда (форс-мейдж).
 */
export function canCurrentUserReview(
  task: Pick<TaskEntity, 'reviewer_id' | 'created_by' | 'column'> | null,
  currentUserId: string | undefined,
  role?: string | null,
): boolean {
  if (!task || !currentUserId) return false;
  if (task.column !== 'review') return false;
  if (role === 'owner' || role === 'admin') return true;
  if (task.reviewer_id === currentUserId) return true;
  if (!task.reviewer_id && !!task.created_by && task.created_by === currentUserId) return true;
  return false;
}

/**
 * Ревью-решение в ленте комментариев (083 fix / 086 approve):
 * авто-комментарий, записанный review_action с source='review'.
 * Лента красит такие карточки циановым бордером (акцент колонки review).
 * Писатели сегодня: review_action(fix) — причина возврата (083),
 * review_action(approve) — «результат согласован» (086).
 */
export function isReviewDecision(
  item: { kind: string; payload?: { source?: unknown } | null } | null | undefined,
): boolean {
  return item?.kind === 'comment' && String(item.payload?.source ?? '') === 'review';
}
