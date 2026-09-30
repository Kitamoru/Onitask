import { describe, it, expect } from 'vitest';
import { buildFullId } from '../../src/lib/realtime/tasks';

/**
 * SUB-01: display-id подзадачи собирается на клиенте, потому что у неё
 * `task_number` = NULL (номер производный — «ONI-42-SUB-1», миграция 139).
 *
 * Функция общая для трёх путей (API mapTaskRow, DataContext, Realtime), поэтому
 * тест здесь закрывает все три сразу: разойтись они могут только тут.
 */
describe('buildFullId (SUB-01)', () => {
  it('обычная задача — без изменений: PREFIX-N', () => {
    expect(buildFullId('ONI', 42, 'uuid-1')).toBe('ONI-42');
    expect(buildFullId('ONI', 42, 'uuid-1', null)).toBe('ONI-42');
  });

  it('подзадача собирает PREFIX-SUB-i даже при task_number = NULL', () => {
    // Регрессия: без этой ветки тут возвращался бы id.slice(0,8) — карточка
    // подзадачи в стриме показывала бы случайный hex вместо номера.
    expect(buildFullId('ONI', null, 'abcdef12-3456', 1)).toBe('ONI-SUB-1');
    expect(buildFullId('ONI', null, 'abcdef12-3456', 10)).toBe('ONI-SUB-10');
  });

  it('subtask_index важнее task_number: подзадача не отдаёт номер родителя', () => {
    // Если бы строка подзадачи несла ещё и task_number, приоритет должен быть
    // за подзадачей — иначе в UI появился бы номер РОДИТЕЛЯ.
    expect(buildFullId('ONI', 42, 'abcdef12-3456', 3)).toBe('ONI-SUB-3');
  });

  it('без префикса подзадача уходит в fallback, а не в «-SUB-1»', () => {
    // 'TASK-SUB-1' выглядел бы настоящим номером, но это выдуманный prefix.
    expect(buildFullId(null, null, 'abcdef12-3456', 1)).toBe('abcdef12');
    expect(buildFullId(undefined, undefined, 'abcdef12-3456', 1)).toBe('abcdef12');
  });

  it('subtask_index = 0 не считается подзадачей (falsy-ловушка)', () => {
    // CHECK в БД: 1..10, так что 0 невозможен из БД. Но проверка `!= null`
    // вместо truthy — иначе «0» тихо превратился бы в prefix-0.
    expect(buildFullId('ONI', 42, 'abcdef12-3456', 0)).toBe('ONI-SUB-0');
  });

  it('с номером родителя — полная форма PREFIX-42-SUB-i, как у RPC task_full_id', () => {
    // Главный баг, найденный владельцем в UI: обогащение задач (lib/
    // taskEnrichment) собирало id мимо buildFullId и отдавало «8a35e04c».
    // Форма «PREFIX-42-SUB-1» обязана совпадать с тем, что Telegram-карточка
    // берёт из БД (миграция 139) — иначе один и тот же пункт называется в двух
    // местах по-разному, а find_task_by_full_id такой id не разобрал бы.
    expect(buildFullId('ONI', null, 'abcdef12-3456', 1, 42)).toBe('ONI-42-SUB-1');
    expect(buildFullId('ONI', null, 'abcdef12-3456', 10, 42)).toBe('ONI-42-SUB-10');
  });

  it('номер родителя не вытесняет subtask_index', () => {
    expect(buildFullId('ONI', 42, 'abcdef12-3456', 3, 42)).toBe('ONI-42-SUB-3');
  });

  it('без номера родителя остаётся PREFIX-SUB-i, а не hex', () => {
    // Номер родителя может не прийти (например, обогащение без батча). Тогда
    // «ONI-SUB-1» всё равно лучше случайного hex, но это уже не полная форма.
    expect(buildFullId('ONI', null, 'abcdef12-3456', 1, null)).toBe('ONI-SUB-1');
  });


  it('без номера и без подзадачи — как раньше, hex от UUID', () => {
    expect(buildFullId('ONI', null, 'abcdef12-3456')).toBe('abcdef12');
    expect(buildFullId('ONI', 0, 'abcdef12-3456')).toBe('abcdef12');
  });
});
