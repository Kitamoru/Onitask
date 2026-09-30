import { describe, it, expect } from 'vitest';
import {
  MAX_SUBTASKS,
  SUBTASK_FORBIDDEN_ASSIGNEE,
  SUBTASK_INITIAL_COLUMN,
  SUBTASK_LIMIT_REACHED,
  SUBTASK_PARENT_IS_SUBTASK,
  SUBTASK_TITLE_MAX,
  SUBTASK_TITLE_REQUIRED,
  canBeSubtaskAssignee,
  groupSubtasksByParent,
  isSubtask,
  nextSubtaskIndex,
  normalizeSubtaskTitle,
  resolveSubtaskReviewerId,
  subtaskOwnerRow,
  subtaskState,
  validateSubtaskParent,
} from '../../src/lib/subtasks';

const human = { id: 'w-1', type: 'human' as const, is_active: true };
const agent = { id: 'w-2', type: 'agent' as const, is_active: true };

describe('canBeSubtaskAssignee', () => {
  it('принимает активного человека', () => {
    expect(canBeSubtaskAssignee(human)).toBe(true);
  });

  it('отклоняет агента — решение владельца: v1 только люди', () => {
    expect(canBeSubtaskAssignee(agent)).toBe(false);
  });

  it('отклоняет неактивного работника', () => {
    expect(canBeSubtaskAssignee({ ...human, is_active: false })).toBe(false);
  });

  it('отклоняет пустого исполнителя', () => {
    expect(canBeSubtaskAssignee(null)).toBe(false);
    expect(canBeSubtaskAssignee(undefined)).toBe(false);
  });
});

describe('resolveSubtaskReviewerId', () => {
  it('берёт автора родителя, если он человек', () => {
    expect(resolveSubtaskReviewerId({ id: 'w-1', type: 'human' })).toBe('w-1');
  });

  it('возвращает null для агента: review_action требует type=human (миг. 086)', () => {
    expect(resolveSubtaskReviewerId({ id: 'w-2', type: 'agent' })).toBeNull();
  });

  it('возвращает null, если автор удалён (created_by = NULL)', () => {
    expect(resolveSubtaskReviewerId({ id: null, type: null })).toBeNull();
    expect(resolveSubtaskReviewerId(null)).toBeNull();
  });

  it('возвращает null при неизвестном типе автора — fail-closed', () => {
    // Тип пришёл из БД; неизвестное значение не должно молча назначить
    // ревьюера, approve которого потом не пройдёт.
    expect(resolveSubtaskReviewerId({ id: 'w-1', type: null })).toBeNull();
  });
});

describe('normalizeSubtaskTitle', () => {
  it('обрезает края', () => {
    expect(normalizeSubtaskTitle('  Написать текст  ')).toBe('Написать текст');
  });

  it('возвращает null для пустого и пробельного текста', () => {
    expect(normalizeSubtaskTitle('   ')).toBeNull();
    expect(normalizeSubtaskTitle('')).toBeNull();
  });

  it('возвращает null для не-строки', () => {
    expect(normalizeSubtaskTitle(42)).toBeNull();
    expect(normalizeSubtaskTitle(null)).toBeNull();
    expect(normalizeSubtaskTitle({})).toBeNull();
  });

  it('обрезает до лимита, а не отвергает', () => {
    const long = 'я'.repeat(SUBTASK_TITLE_MAX + 50);
    expect(normalizeSubtaskTitle(long)).toHaveLength(SUBTASK_TITLE_MAX);
  });
});

describe('nextSubtaskIndex', () => {
  it('начинается с 1 для пустого набора', () => {
    expect(nextSubtaskIndex([])).toBe(1);
  });

  it('берёт max+1, а не count+1: после удаления позиции не сдвигаются', () => {
    // Подзадачи 1 и 3. Если бы считали count, новая получила бы 3 и
    // столкнулась бы с существующей третьей (23505).
    expect(nextSubtaskIndex([1, 3])).toBe(4);
  });

  it('игнорирует null и нечисловые значения', () => {
    expect(nextSubtaskIndex([null, 2, null])).toBe(3);
  });

  it('не уменьшает номер, если набор пуст после всех удалений', () => {
    expect(nextSubtaskIndex([null, null])).toBe(1);
  });
});

describe('validateSubtaskParent', () => {
  it('принимает самостоятельную задачу', () => {
    expect(validateSubtaskParent({ parent_task_id: null })).toBeNull();
  });

  it('отклоняет подзадачу для подзадачи — один уровень вложенности', () => {
    expect(validateSubtaskParent({ parent_task_id: 'p-1' })).toBe(
      SUBTASK_PARENT_IS_SUBTASK,
    );
  });

  it('сообщает о ненайденной задаче', () => {
    expect(validateSubtaskParent(null)).toBe('Задача не найдена');
  });
});

describe('subtaskState', () => {
  const now = new Date('2026-03-10T12:00:00Z');

  it('закрытая подзадача остаётся done, даже если срок прошёл', () => {
    // Регрессия: закрытая позже срока подзадача не должна краснеть задним числом.
    expect(
      subtaskState({ column: 'done', deadline: '2026-03-09T00:00:00Z', now }),
    ).toBe('done');
  });

  it('незакрытая с прошедшим сроком — overdue независимо от колонки', () => {
    for (const column of ['backlog', 'in_progress', 'review']) {
      expect(subtaskState({ column, deadline: '2026-03-09T00:00:00Z', now })).toBe(
        'overdue',
      );
    }
  });

  it('срок не наступил — состояние по колонке', () => {
    expect(
      subtaskState({ column: 'in_progress', deadline: '2026-03-11T00:00:00Z', now }),
    ).toBe('in_progress');
    expect(
      subtaskState({ column: 'review', deadline: '2026-03-11T00:00:00Z', now }),
    ).toBe('review');
    expect(subtaskState({ column: 'backlog', now })).toBe('backlog');
  });

  it('битый срок не считается просрочкой', () => {
    // 'не дата' → Invalid Date. Без Number.isNaN дата-мусор красил бы карточку
    // красным молча.
    expect(subtaskState({ column: 'in_progress', deadline: 'не дата', now })).toBe(
      'in_progress',
    );
  });
});

describe('isSubtask', () => {
  it('пустой parent не считается подзадачей', () => {
    expect(isSubtask({ parent_task_id: null })).toBe(false);
    expect(isSubtask({ parent_task_id: '' })).toBe(false);
    expect(isSubtask({})).toBe(false);
    expect(isSubtask(null)).toBe(false);
    expect(isSubtask(undefined)).toBe(false);
  });

  it('непустой parent — подзадача', () => {
    expect(isSubtask({ parent_task_id: 'p-1' })).toBe(true);
  });
});

describe('groupSubtasksByParent', () => {
  it('родители без подзадач не попадают в карту', () => {
    const grouped = groupSubtasksByParent([
      { id: 'a', parent_task_id: null, subtask_index: null },
    ]);
    expect(grouped.size).toBe(0);
  });

  it('группирует по родителю и сортирует по subtask_index, не по порядку входа', () => {
    const grouped = groupSubtasksByParent([
      { id: 's3', parent_task_id: 'p1', subtask_index: 3 },
      { id: 'root', parent_task_id: null, subtask_index: null },
      { id: 's1', parent_task_id: 'p1', subtask_index: 1 },
      { id: 'x1', parent_task_id: 'p2', subtask_index: 1 },
    ]);
    expect(grouped.get('p1')?.map((t) => t.id)).toEqual(['s1', 's3']);
    expect(grouped.get('p2')?.map((t) => t.id)).toEqual(['x1']);
  });

  it('подзадача без subtask_index не падает и встаёт в начало', () => {
    const grouped = groupSubtasksByParent([
      { id: 's2', parent_task_id: 'p1', subtask_index: 2 },
      { id: 'sNull', parent_task_id: 'p1', subtask_index: null },
    ]);
    expect(grouped.get('p1')?.map((t) => t.id)).toEqual(['sNull', 's2']);
  });
});


describe('subtaskOwnerRow (SUB-01) — чьи права на удаление подзадачи', () => {
  const subtask = (over = {}) => ({
    created_by: 'admin-who-added',
    assigned_to: 'executor',
    column: 'backlog',
    parent_task_id: 'parent-1',
    ...over,
  });
  const parent = (over = {}) => ({
    created_by: 'task-author',
    assigned_to: 'executor',
    column: 'in_progress',
    ...over,
  });

  it('подзадача наследует права РОДИТЕЛЯ, а не своего created_by', () => {
    // Ключевой случай: админ добавил подзадачу в чужую задачу. created_by
    // подзадачи = админ, но удалить её должен автор задачи, а не админ-заёмник
    // и уж точно не автор задачи не должен зависеть от того, кто нажал кнопку.
    expect(subtaskOwnerRow(subtask(), parent())).toEqual(parent());
  });

  it('самостоятельная задача → null: права считаются по ней самой', () => {
    expect(subtaskOwnerRow(subtask({ parent_task_id: null }), parent())).toBeNull();
  });

  it('родитель исчез (гонка с CASCADE) → права самой подзадачи, не молчание', () => {
    // Строгая проверка лучше, чем разрешить удаление при неясном владельце.
    const s = subtask();
    expect(subtaskOwnerRow(s, null)).toEqual({
      created_by: s.created_by,
      assigned_to: s.assigned_to,
      column: s.column,
    });
    expect(subtaskOwnerRow(s, undefined)).not.toBeNull();
  });

  it('подзадача без своего created_by всё равно наследует родителя', () => {
    // Раньше (до фикса) created_by = null давал бы canDelete = false для всех,
    // кроме админа, и родительский автор терял бы право убрать подзадачу.
    expect(
      subtaskOwnerRow(subtask({ created_by: null }), parent()),
    ).toEqual(parent());
  });
});

describe('константы контракта', () => {
  it('лимит подзадач = 10 и совпадает с CHECK в БД', () => {
    expect(MAX_SUBTASKS).toBe(10);
  });

  it('стартовая колонка — backlog, is_inbox выставляется отдельно', () => {
    expect(SUBTASK_INITIAL_COLUMN).toBe('backlog');
  });

  it('тексты отказа непустые — UI показывает их пользователю', () => {
    for (const text of [
      SUBTASK_FORBIDDEN_ASSIGNEE,
      SUBTASK_LIMIT_REACHED,
      SUBTASK_PARENT_IS_SUBTASK,
      SUBTASK_TITLE_REQUIRED,
    ]) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
