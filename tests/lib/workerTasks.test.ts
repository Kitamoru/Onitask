import { describe, it, expect } from 'vitest';
import {
  selectWorkerTaskSections,
  selectWorkerWorkingTasks,
} from '@/lib/workerTasks';
import type { TaskEntity } from '@/types/flowboard';

/**
 * Отбор задач воркера по секциям статуса в шторке карточки участника.
 *
 * Тест вызывает функцию, а не ищет текст в исходнике (AGENTS.md §5): рендер-тестов
 * для компонентов в проекте нет (vitest — `environment: 'node'`, RTL не подключён),
 * поэтому единственный способ доказать, что «В очереди» реально отбирается —
 * исполнить селектор. Мутация `column === 'backlog'` роняет эти тесты; закомментированная
 * строка с тем же текстом — нет.
 */

let seq = 0;

/** Минимальная задача; лишние поля не влияют на отбор. */
function task(over: Partial<TaskEntity> = {}): TaskEntity {
  seq += 1;
  return { id: `t${seq}`, column: 'backlog', ...over } as TaskEntity;
}

const ME = 'worker-me';
const OTHER = 'worker-other';

describe('selectWorkerTaskSections', () => {
  it('кладёт задачу в «В очереди» по column=backlog и назначенному исполнителю', () => {
    const t = task({ column: 'backlog', assigned_to: ME });
    const { queue, inProgress, review } = selectWorkerTaskSections([t], ME);
    expect(queue).toEqual([t]);
    expect(inProgress).toEqual([]);
    expect(review).toEqual([]);
  });

  it('не показывает в очереди задачи других исполнителей', () => {
    const mine = task({ column: 'backlog', assigned_to: ME });
    const theirs = task({ column: 'backlog', assigned_to: OTHER });
    const { queue } = selectWorkerTaskSections([mine, theirs], ME);
    expect(queue).toEqual([mine]);
  });

  it('«В очереди» не берёт по reviewer_id — там нужен assigned_to', () => {
    // Задачу в очереди ревьюер не ждёт: она ещё не готова к проверке.
    const t = task({ column: 'backlog', reviewer_id: ME, assigned_to: OTHER });
    expect(selectWorkerTaskSections([t], ME).queue).toEqual([]);
  });

  it('«В работе» — только in_progress у исполнителя', () => {
    const t = task({ column: 'in_progress', assigned_to: ME });
    const { inProgress } = selectWorkerTaskSections([t], ME);
    expect(inProgress).toEqual([t]);
  });

  it('«На проверке» — по reviewer_id, а не по assigned_to', () => {
    // Ключевое различие секций: исполнитель задачи в review её не проверяет.
    const reviewing = task({ column: 'review', reviewer_id: ME, assigned_to: OTHER });
    const writing = task({ column: 'review', reviewer_id: OTHER, assigned_to: ME });
    const { review } = selectWorkerTaskSections([reviewing, writing], ME);
    expect(review).toEqual([reviewing]);
  });

  it('разбирает доску по всем секциям сразу, не теряя и не дублируя', () => {
    const q = task({ column: 'backlog', assigned_to: ME });
    const w = task({ column: 'in_progress', assigned_to: ME });
    const r = task({ column: 'review', reviewer_id: ME });
    const foreign = task({ column: 'in_progress', assigned_to: OTHER });
    const result = selectWorkerTaskSections([q, w, r, foreign], ME);
    expect(result).toEqual({ queue: [q], inProgress: [w], review: [r] });
  });

  it('скрывает завершённые (done) из всех секций', () => {
    const done = task({ column: 'done', assigned_to: ME, reviewer_id: ME });
    const result = selectWorkerTaskSections([done], ME);
    expect(result.queue).toEqual([]);
    expect(result.inProgress).toEqual([]);
    expect(result.review).toEqual([]);
  });

  it('без workerId не показывает ничего — в т.ч. задачи без исполнителя', () => {
    // Регрессия на ловушку `assigned_to === undefined`: у задач без
    // исполнителя поле undefined, и без guard воркер увидел бы чужие задачи.
    const orphan = task({ column: 'backlog', assigned_to: null });
    expect(selectWorkerTaskSections([orphan], null).queue).toEqual([]);
    expect(selectWorkerTaskSections([orphan], undefined).queue).toEqual([]);
  });

  it('не мутирует исходный массив и не возвращает общие ссылки на пустые секции', () => {
    const tasks = [task({ column: 'backlog', assigned_to: OTHER })];
    const first = selectWorkerTaskSections(tasks, ME);
    const second = selectWorkerTaskSections(tasks, ME);
    expect(tasks).toHaveLength(1);
    // Разные вызовы — разные массивы: иначе мутация одного рендера утекла бы
    // в следующий (EMPTY_SECTIONS на все три секции).
    expect(first.queue).not.toBe(second.queue);
    expect(selectWorkerTaskSections(tasks, null).queue).not.toBe(
      selectWorkerTaskSections(tasks, null).queue,
    );
  });
});

describe('selectWorkerWorkingTasks: когнитивная нагрузка', () => {
  it('считает in_progress и review, но НЕ очередь', () => {
    // A-09: бюджет считает работу, а не её ожидание. Если backlog попадёт
    // в сумму, поедут метрики «Назначено SP» / gap на карточке воркера.
    const q = task({ column: 'backlog', assigned_to: ME });
    const w = task({ column: 'in_progress', assigned_to: ME });
    const r = task({ column: 'review', assigned_to: ME });
    expect(selectWorkerWorkingTasks([q, w, r], ME)).toEqual([w, r]);
  });

  it('предикат тот же, что был до рефакторинга: assigned_to, а не reviewer_id', () => {
    // Метрики НЕ должны расшириться новой секцией «На проверке» — воркер,
    // который только проверяет чужую задачу, не несёт её когнитивной нагрузки.
    const onlyReviews = task({ column: 'review', reviewer_id: ME, assigned_to: OTHER });
    expect(selectWorkerWorkingTasks([onlyReviews], ME)).toEqual([]);
  });

  it('без workerId — пусто', () => {
    const w = task({ column: 'in_progress', assigned_to: ME });
    expect(selectWorkerWorkingTasks([w], null)).toEqual([]);
  });
});