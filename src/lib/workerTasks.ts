import type { TaskEntity } from '@/types/flowboard';

/**
 * Отбор задач воркера по статусам для шторки карточки участника
 * (`WorkerSheet`, таб «Статус»).
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ФИЛЬТР В КОМПОНЕНТЕ. Три секции статуса
 * жили инлайновыми `useMemo` прямо в компоненте, и их нечем было проверить:
 * тестовой среды для React-компонентов в проекте нет (`vitest` работает в
 * `environment: 'node'`, RTL не подключён), а text-guard вида «в файле есть
 * фильтр по backlog» удовлетворяется закомментированной строкой (AGENTS.md
 * §5). Чистая функция проверяется настоящим вызовом: мутация условия роняет
 * тест.
 *
 * ПРАВИЛА ОТБОРА (они не взаимозаменяемы):
 *   · `queue`      — исполнитель, колонка `backlog` («В очереди»);
 *   · `inProgress` — исполнитель, колонка `in_progress` («В работе»);
 *   · `review`     — ПРОВЕРЯЮЩИЙ, колонка `review` («На проверке»).
 *
 * Последнее отличается от первых двух намеренно: задача в `review` значима
 * для того, кто её проверяет, а не для того, кто её писал. Исполнитель с
 * `reviewer_id` в эту секцию не попадает — иначе ревьюер увидел бы задачу,
 * которую ему не проверять.
 *
 * Что осознанно НЕ отбирается: `done`. Завершённые задачи не показываются
 * в шторке воркера — так же, как они скрыты из списка на карточке участника
 * (`tasksToWorkerTaskList` в `app/flowboard/page.tsx`).
 */
export interface WorkerTaskSections {
  /** «В очереди» — назначенные исполнителю, колонка `backlog`. */
  queue: TaskEntity[];
  /** «В работе» — назначенные исполнителю, колонка `in_progress`. */
  inProgress: TaskEntity[];
  /** «На проверке» — где воркер проверяющий, колонка `review`. */
  review: TaskEntity[];
}

/**
 * Разбирает задачи доски по трём секциям статуса конкретного воркера.
 *
 * Порядок полей совпадает с порядком колонок доски
 * (backlog → in_progress → review). Порядок отрисовки задаёт вызывающий.
 *
 * Каждый вызов возвращает СВЕЖИЕ массивы. Общая константа на пустой результат
 * тут была бы ловушкой: секцию можно отсортировать или отфильтровать на месте
 * (`.sort`, `.splice`), и мутация уехала бы во все последующие вызовы, а
 * победил бы ещё и чужой рендер. Это не гипотетика — тест на разные ссылки
 * ловит именно такую подмену.
 */
export function selectWorkerTaskSections(
  tasks: TaskEntity[],
  workerId: string | null | undefined,
): WorkerTaskSections {
  // Без workerId любой отбор дал бы лишнее: у задач без исполнителя
  // `assigned_to === undefined`, и воркер увидел бы чужие безымянные задачи.
  if (!workerId) return { queue: [], inProgress: [], review: [] };

  const queue: TaskEntity[] = [];
  const inProgress: TaskEntity[] = [];
  const review: TaskEntity[] = [];

  for (const task of tasks) {
    if (task.column === 'backlog') {
      if (task.assigned_to === workerId) queue.push(task);
      continue;
    }
    if (task.column === 'in_progress') {
      if (task.assigned_to === workerId) inProgress.push(task);
      continue;
    }
    if (task.column === 'review' && task.reviewer_id === workerId) {
      review.push(task);
    }
  }

  return { queue, inProgress, review };
}

/**
 * Задачи, попадающие в когнитивную нагрузку воркера: `in_progress` + `review`,
 * назначенные ЕМУ (исполнителем, не проверяющим).
 *
 * Отдельная функция не из лишней абстракции, а потому что предикат здесь
 * ДРУГОЙ, чем у секций выше: очередь в неё не входит намеренно — бюджет
 * (A-09) считает работу, а не её ожидание. Добавление `backlog` в эту сумму
 * сдвинуло бы метрики «Назначено SP» / gap на карточке воркера.
 */
export function selectWorkerWorkingTasks(
  tasks: TaskEntity[],
  workerId: string | null | undefined,
): TaskEntity[] {
  if (!workerId) return [];
  return tasks.filter(
    (task) =>
      task.assigned_to === workerId &&
      (task.column === 'in_progress' || task.column === 'review'),
  );
}