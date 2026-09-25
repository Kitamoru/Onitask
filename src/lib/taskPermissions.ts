/**
 * TASK-PERM: модель прав на запись в задачу.
 *
 * Вынесена отдельно (без UI- и DB-зависимостей), чтобы unit-тестировать
 * бизнес-правило «кто что может с задачей» в node-env (vitest) без jsdom/RTL —
 * тот же приём, что в `reviewDecision.ts` и `streamFilter.ts`.
 *
 * Правило (согласовано 2026-09-25):
 *   · owner/admin — всё (форс-мейдж);
 *   · автор задачи (created_by) — переместить, править, удалить;
 *   · исполнитель (assigned_to) — переместить и править, но НЕ удалять;
 *   · остальные участники доски — ничего;
 *   · self-claim: участник может взять задачу в работу (assigned_to = мой worker),
 *     но только из backlog и только если исполнитель ещё не назначен.
 *
 * Семантика совпадает с уже принятой моделью review-решения
 * (`reviewDecision.ts` / миграции 049, 083), чтобы две фичи не расходились.
 *
 * Важно: «переместить» и «отредактировать» — это один и тот же PATCH
 * `/api/tasks/[id]`, различается только набор полей. Поэтому отдельного
 * флага canMove нет: запрет canEdit автоматически закрывает и перемещение.
 */

export interface TaskPermissionSubject {
  created_by: string | null;
  assigned_to: string | null;
  column: string;
}

export interface TaskPermissionContext {
  /** worker.id текущего пользователя в workspace задачи (не profiles.id!) */
  workerId: string | null | undefined;
  /** workers.role текущего пользователя: owner | admin | member | viewer | null */
  role: string | null | undefined;
}

export interface TaskPermission {
  isAdmin: boolean;
  isCreator: boolean;
  isAssignee: boolean;
  /** PATCH любых полей, включая перемещение в другую колонку */
  canEdit: boolean;
  canDelete: boolean;
  /** Задача в backlog без исполнителя — её можно взять себе */
  canClaim: boolean;
}

export const CLAIMABLE_COLUMN = 'backlog';

/**
 * Единственный источник истины по правам на запись в задачу.
 * Чистая функция: серверный Route Handler и клиентский UI зовут её одну и ту же,
 * поэтому UI не может разойтись с сервером (та же идея, что reviewDecision.ts).
 */
export function getTaskPermission(
  task: TaskPermissionSubject | null | undefined,
  ctx: TaskPermissionContext,
): TaskPermission {
  if (!task || !ctx.workerId) {
    return {
      isAdmin: false,
      isCreator: false,
      isAssignee: false,
      canEdit: false,
      canDelete: false,
      canClaim: false,
    };
  }

  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
  const isCreator = !!task.created_by && task.created_by === ctx.workerId;
  const isAssignee = !!task.assigned_to && task.assigned_to === ctx.workerId;
  // Перемещение — это PATCH с полем column, поэтому canEdit покрывает и его.
  const canEdit = isAdmin || isCreator || isAssignee;
  const canDelete = isAdmin || isCreator;

  return {
    isAdmin,
    isCreator,
    isAssignee,
    canEdit,
    canDelete,
    canClaim:
      !canEdit &&
      task.assigned_to === null &&
      task.column === CLAIMABLE_COLUMN,
  };
}

/** Тексты отказа — единые для сервера и клиента. */
export const TASK_FORBIDDEN_EDIT = 'Недостаточно прав: двигать и редактировать задачу может её автор, исполнитель или администратор доски';
export const TASK_FORBIDDEN_DELETE = 'Удалить задачу может только её автор или администратор доски';
export const TASK_FORBIDDEN_CLAIM = 'Взять задачу в работу может только её автор или администратор доски';
