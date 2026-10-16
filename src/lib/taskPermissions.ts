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
 * SUB-01: для подзадач действует `getSubtaskPermission` (см. ниже) — владение
 * наследуется от родителя, а собственный исполнитель подзадачи может её
 * править/двигать (сдавать).
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

/**
 * SUB-01: права на запись в ПОДЗАДАЧУ.
 *
 * Подзадача — строка tasks с parent_task_id, но её владение наследуется от
 * РОДИТЕЛЯ (created_by/assigned_to родителя, колонка — собственная, от неё
 * зависит self-claim; тот же контракт, что subtaskOwnerRow в subtasks.ts).
 *
 * Дополнение (фикс бага «исполнитель подзадачи не может её сдать»): собственный
 * исполнитель подзадачи (assigned_to САМОЙ подзадачи) может её править и
 * двигать — иначе участник, которому подзадача назначена, не видел кнопку
 * «Переместить» в шторке и получал 403 на PATCH. Удалять он по-прежнему не
 * может: удаление — только автор родителя или админ (ADR SUB-01, canDelete
 * берётся из базовых родительских прав без подмешивания исполнительства).
 *
 * `parent == null` — самостоятельная задача (или гонка с ON DELETE CASCADE,
 * родитель исчез): права считаются по самой строке, как раньше.
 *
 * self-claim решается по САМОЙ подзадаче (её assigned_to и колонка), как и
 * записано в route.ts: «взять подзадачу в работу должно решаться по подзадаче,
 * не по родителю».
 */
export function getSubtaskPermission(
  subtask: TaskPermissionSubject | null | undefined,
  parent: Pick<TaskPermissionSubject, 'created_by' | 'assigned_to'> | null | undefined,
  ctx: TaskPermissionContext,
): TaskPermission {
  if (!subtask || !ctx.workerId) {
    return getTaskPermission(null, ctx);
  }
  // Самостоятельная задача / родитель не найден — правило по самой строке.
  if (!parent) {
    return getTaskPermission(subtask, ctx);
  }

  // Владение наследуем от родителя, колонка остаётся собственной подзадачи.
  const base = getTaskPermission(
    {
      created_by: parent.created_by,
      assigned_to: parent.assigned_to,
      column: subtask.column,
    },
    ctx,
  );
  const isOwnAssignee = !!subtask.assigned_to && subtask.assigned_to === ctx.workerId;
  const canEdit = base.canEdit || isOwnAssignee;

  return {
    ...base,
    isAssignee: base.isAssignee || isOwnAssignee,
    canEdit,
    canClaim:
      !canEdit &&
      subtask.assigned_to === null &&
      subtask.column === CLAIMABLE_COLUMN,
  };
}

/** Тексты отказа — единые для сервера и клиента. */
export const TASK_FORBIDDEN_EDIT = 'Недостаточно прав: двигать и редактировать задачу может её автор, исполнитель или администратор доски';
export const TASK_FORBIDDEN_DELETE = 'Удалить задачу может только её автор или администратор доски';
export const TASK_FORBIDDEN_CLAIM = 'Взять задачу в работу может только её автор или администратор доски';
