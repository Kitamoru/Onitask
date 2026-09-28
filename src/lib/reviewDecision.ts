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
/**
 * REV-02: итоговый результат задачи — ровно один комментарий на задачу.
 *
 * Отдельный предикат, а не расширение isReviewDecision: source='result' нельзя
 * смешивать с source='agent'. Под source='agent' идут и обычные реплики агента,
 * и подробности сдачи (details), поэтому «покрасить всё агентское» означало бы
 * позеленить лишнее. Итог помечен собственным значением — миграция 136.
 */
export function isResultArtifact(
  item: { kind: string; payload?: { source?: unknown } | null } | null | undefined,
): boolean {
  return item?.kind === 'comment' && String(item.payload?.source ?? '') === 'result';
}

export function isReviewDecision(
  item: { kind: string; payload?: { source?: unknown } | null } | null | undefined,
): boolean {
  return item?.kind === 'comment' && String(item.payload?.source ?? '') === 'review';
}

/**
 * REV-02: назначенный ревьюер — не формальность, мимо него ходить нельзя.
 *
 * Замер 2026-09-27: гвард на переход review → done был ТОЛЬКО для случая
 * «ревьюер не назначен» (`!taskRow.reviewer_id` в route.ts, `!reviewer_id` в
 * moveTask.ts, `reviewer_id IS NULL` в миграции 082). При назначенном ревьюере
 * не срабатывал ни один из трёх, и оставалась только общая проверка прав, её
 * проходит исполнитель. То есть исполнитель мог перетащить задачу с ревьюером
 * прямо в «Сделано»: ревьюер пропущен, `review_pending` не снят, комментарий
 * «согласован» не написан, а `notify_task_done` всё равно отчитывается по
 * `OLD.column = 'review'` как о согласовании.
 *
 * Этот предикат закрывает именно новый случай. Случай «ревьюер не назначен»
 * НЕ трогаем: там поведение route/moveTask/БД различается между собой
 * исторически, и менять его здесь — отдельная задача со своим регрессом.
 *
 * @param task колонка и назначенный ревьюер задачи
 * @param ctx worker.id текущего пользователя и его роль в воркспейсе
 * @returns true — согласование обязательно и обойти его нельзя
 */
export function isReviewBypassBlocked(
  task: { column: string; reviewer_id?: string | null },
  ctx: { workerId?: string | null; role?: string | null },
): boolean {
  if (task.column !== 'review') return false;
  if (!task.reviewer_id) return false;
  if (ctx.role === 'owner' || ctx.role === 'admin') return false;
  return task.reviewer_id !== (ctx.workerId ?? null);
}

export const REVIEW_BYPASS_BLOCKED =
  'Задача на проверке: перевести её в «Сделано» может только назначенный проверяющий или администратор доски';
