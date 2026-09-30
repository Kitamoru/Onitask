/**
 * SUB-01: правила создания подзадачи.
 *
 * Вынесено в чистый модуль (без UI- и DB-зависимостей), чтобы unit-тестировать
 * бизнес-правила «кому и что можно назначить подзадачей» в node-env (vitest) —
 * тот же приём, что в `taskPermissions.ts`, `reviewDecision.ts`, `streamFilter.ts`.
 *
 * Серверный Route Handler и клиентский UI зовут одни и те же функции, поэтому
 * UI не может пообещать то, что сервер отклонит.
 *
 * Решения владельца (2026-09-30), см. ADR-2026-09-30 в docs/memory-bank/decisions.md:
 *   · нагрузку подзадача не создаёт — её наследует родитель;
 *   · ревьюер подзадач — всегда автор родительской задачи;
 *   · AI-агентом подзадачу назначать нельзя (только в будущей версии);
 *   · авто-закрытия родителя нет.
 */

/** Потолок подзадач на задачу. Продуктовое требование владельца + CHECK в БД. */
export const MAX_SUBTASKS = 10;

/** Стартовая колонка подзадачи: поставлена осознанно, не «черновик» (is_inbox=false). */
export const SUBTASK_INITIAL_COLUMN = 'backlog' as const;

export const SUBTASK_TITLE_MAX = 500;

/**
 * Состояние подзадачи для UI — то, чем красится карточка в списке.
 *
 * Порядок важен: 'overdue' проверяется ПОСЛЕ 'done'. Закрытая в срок после
 * дедлайна подзадача не должна краснеть задним числом, но просроченная и
 * незакрытая обязана краснеть независимо от колонки.
 */
export type SubtaskState = 'done' | 'overdue' | 'in_progress' | 'review' | 'backlog';

export interface SubtaskStateInput {
  column: string;
  deadline?: string | null;
  /** Текущий момент — передаётся явно, чтобы правило было чистым и тестируемым. */
  now?: Date;
}

/** Состояние подзадачи по колонке и сроку. Просрочка = срок прошёл и не done. */
export function subtaskState({
  column,
  deadline,
  now = new Date(),
}: SubtaskStateInput): SubtaskState {
  if (column === 'done') return 'done';
  if (deadline) {
    // Без Number.isNaN: сравнение с NaN всегда false, то есть битый срок сам
    // по себе не станет просрочкой. Отдельный guard тут был мёртвым кодом —
    // он проверял ровно то, что и так верно (проверено мутацией).
    const due = new Date(deadline);
    if (due.getTime() < now.getTime()) {
      return 'overdue';
    }
  }
  if (column === 'review') return 'review';
  if (column === 'in_progress') return 'in_progress';
  return 'backlog';
}

/** Подпись колонки для карточки подзадачи. */
export const SUBTASK_STATE_LABEL: Record<SubtaskState, string> = {
  done: 'Готово',
  overdue: 'Просрочена',
  in_progress: 'В работе',
  review: 'На проверке',
  backlog: 'В очереди',
};

/** Подзадача = строка tasks с непустым parent_task_id. */
export function isSubtask(
  task: { parent_task_id?: string | null } | null | undefined,
): boolean {
  return !!task?.parent_task_id;
}

/** Минимальный набор полей, по которому считаются права на владение задачей. */
export interface TaskOwnershipFields {
  created_by: string | null;
  assigned_to: string | null;
  column: string;
  parent_task_id: string | null;
}

/**
 * SUB-01: чьи права определяют владение подзадачей.
 *
 * Подзадача не самостоятельная единица — она часть жизненного цикла задачи.
 * Поэтому её `created_by` (тот, кто нажал «добавить подзадачу») НЕ должен
 * определять, кто может её удалить: иначе админ, добавивший подзадачу в чужую
 * задачу, забрал бы у автора задачи право её убрать. Владелец подзадачей —
 * родитель: автор родителя или администратор доски.
 *
 * Возвращает null, если родителя нет (самостоятельная задача) — тогда вызывающий
 * код считает права по самой задаче, как раньше.
 */
export function subtaskOwnerRow<T extends TaskOwnershipFields>(
  task: T,
  parent: Pick<TaskOwnershipFields, 'created_by' | 'assigned_to' | 'column'> | null | undefined,
): Pick<TaskOwnershipFields, 'created_by' | 'assigned_to' | 'column'> | null {
  if (!task.parent_task_id) return null;
  // Родитель мог исчезнуть (ON DELETE CASCADE уносит подзадачу вместе с ним, но
  // между транзакциями возможна гонка). Тогда падаем на права самой подзадачи —
  // строгая проверка лучше, чем молчаливое разрешение.
  return parent ?? {
    created_by: task.created_by,
    assigned_to: task.assigned_to,
    column: task.column,
  };
}


/**
 * Группировка подзадач по родителю — для выборки из общего стора задач.
 *
 * Родители без подзадач в карту не попадают: показывать ли пустую секцию,
 * решает UI. Порядок внутри группы — по subtask_index, а не по времени
 * создания (иначе список прыгал бы после любого обновления задачи).
 */
export function groupSubtasksByParent<T extends SubtaskRowLike>(
  tasks: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const bucket = grouped.get(task.parent_task_id);
    if (bucket) {
      bucket.push(task);
    } else {
      grouped.set(task.parent_task_id, [task]);
    }
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => subtaskIndexOf(a) - subtaskIndexOf(b));
  }
  return grouped;
}

export interface SubtaskRowLike {
  parent_task_id: string | null;
  subtask_index?: number | null;
}

function subtaskIndexOf(task: SubtaskRowLike): number {
  return typeof task.subtask_index === 'number' ? task.subtask_index : 0;
}

export interface SubtaskAssignee {
  id: string;
  type: 'human' | 'agent';
  is_active: boolean;
}

export interface SubtaskReviewerCandidate {
  id: string | null;
  type: 'human' | 'agent' | null;
}

/**
 * Кому можно назначить подзадачу.
 *
 * v1 — только активный человек. Агент отклоняется осознанно (решение владельца):
 * подзадача у агента потащила бы за собой dispatch_outbox → ops_lease →
 * agent-runtime и контекст родителя в get_task_context, чего в этой версии нет.
 */
export function canBeSubtaskAssignee(
  worker: SubtaskAssignee | null | undefined,
): boolean {
  return !!worker && worker.type === 'human' && worker.is_active;
}

/**
 * Ревьюер подзадачи — автор родительской задачи (решение владельца).
 *
 * Возвращает worker.id только если автор — человек: `review_action` требует
 * `type='human'` от актора (миграция 086), поэтому ревьюер-агент заблокировал
 * бы approve навсегда, и подзадача зависла бы в review.
 *
 * null в остальных случаях (автор удалён / автор — агент) — тогда работает
 * существующий путь review_pending: закрыть сможет owner/admin (формс-мейдж).
 */
/**
 * Достаёт reviewer_id из правила, применённого Route Handler'ом.
 * Отдельная функция нужна, чтобы её можно было подменить мутацией.
 */
export function resolveSubtaskReviewerId(
  parentAuthor: SubtaskReviewerCandidate | null | undefined,
): string | null {
  if (!parentAuthor?.id) return null;
  if (parentAuthor.type !== 'human') return null;
  return parentAuthor.id;
}

/** Тексты отказа — единые для сервера и клиента (как TASK_FORBIDDEN_EDIT). */
export const SUBTASK_FORBIDDEN_ASSIGNEE =
  'Подзадачу можно назначить только сотруднику команды: назначение AI-агенту появится позже';

export const SUBTASK_LIMIT_REACHED = `Достигнут лимит ${MAX_SUBTASKS} подзадач на задачу`;

export const SUBTASK_PARENT_IS_SUBTASK =
  'Нельзя создать подзадачу для подзадачи';

export const SUBTASK_TITLE_REQUIRED = 'Укажите содержание подзадачи';

/**
 * Нормализация содержания подзадачи.
 * Возвращает null для пустого текста — вызывающий код сам решает, 400 это или
 * «пропустить пустую строку» (в форме пустая строка просто не отправляется).
 */
export function normalizeSubtaskTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, SUBTASK_TITLE_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Номер подзадачи по её позиции в наборе существующих.
 *
 * Берём max(subtask_index), а не count: после удаления подзадачи №2 позиции
 * не должны сдвинуться, иначе «удалил вторую — третья стала второй» соврёт
 * с тем, что человек видит в карточке. Неиспользуемый номер просто не
 * выдаётся следующей подзадаче.
 */
export function nextSubtaskIndex(
  existingIndexes: readonly (number | null)[],
): number {
  const max = existingIndexes.reduce<number>(
    (acc, idx) => (typeof idx === 'number' && idx > acc ? idx : acc),
    0,
  );
  return max + 1;
}

/**
 * Подзадача не может быть вложена в подзадачу (один уровень, как Decide).
 * Возвращает текст отказа или null, если всё в порядке.
 */
export function validateSubtaskParent(
  parent: { parent_task_id: string | null } | null | undefined,
): string | null {
  if (!parent) return 'Задача не найдена';
  if (parent.parent_task_id) return SUBTASK_PARENT_IS_SUBTASK;
  return null;
}
