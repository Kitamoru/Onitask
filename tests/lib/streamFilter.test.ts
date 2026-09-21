// Tests for src/lib/streamFilter.ts — STREAM-01 персональный фильтр Stream.
// Правило: в stream видны только задачи, созданные пользователем, назначенные
// ему, на проверке у него (reviewer) или переданные ему (handoff).

import { describe, it, expect } from 'vitest';
import { filterTasksForUser } from '../../src/lib/streamFilter';

type FilterTask = {
  id: string;
  assigned_to: string | null;
  created_by: string | null;
  reviewer_id: string | null;
  handoff_to: string | null;
};

const makeTask = (over: Partial<FilterTask> = {}): FilterTask => ({
  id: 't-1',
  assigned_to: null,
  created_by: null,
  reviewer_id: null,
  handoff_to: null,
  ...over,
});

describe('filterTasksForUser (STREAM-01)', () => {
  it('показывает задачу, назначенную пользователю (assigned_to)', () => {
    const tasks = [makeTask({ id: 'a', assigned_to: 'me' })];
    expect(filterTasksForUser(tasks, 'me')).toEqual(tasks);
  });

  it('показывает задачу, созданную пользователем (created_by)', () => {
    const tasks = [makeTask({ id: 'b', created_by: 'me' })];
    expect(filterTasksForUser(tasks, 'me')).toEqual(tasks);
  });

  it('показывает задачу, где пользователь reviewer', () => {
    const tasks = [makeTask({ id: 'c', reviewer_id: 'me' })];
    expect(filterTasksForUser(tasks, 'me')).toEqual(tasks);
  });

  it('показывает задачу, переданную пользователю (handoff_to)', () => {
    const tasks = [makeTask({ id: 'd', handoff_to: 'me' })];
    expect(filterTasksForUser(tasks, 'me')).toEqual(tasks);
  });

  it('скрывает чужую задачу (никакой связи с пользователем)', () => {
    const tasks = [
      makeTask({ id: 'other', assigned_to: 'w-1', created_by: 'w-2', reviewer_id: 'w-3' }),
    ];
    expect(filterTasksForUser(tasks, 'me')).toEqual([]);
  });

  it('комбинированное: из набора остаются только «свои» (все роли разом)', () => {
    const tasks = [
      makeTask({ id: 'assigned', assigned_to: 'me' }),
      makeTask({ id: 'created', created_by: 'me' }),
      makeTask({ id: 'review', reviewer_id: 'me' }),
      makeTask({ id: 'handoff', handoff_to: 'me' }),
      makeTask({ id: 'foreign', assigned_to: 'w-9' }),
      makeTask({ id: 'nobody' }),
    ];
    expect(filterTasksForUser(tasks, 'me').map((t) => t.id)).toEqual([
      'assigned',
      'created',
      'review',
      'handoff',
    ]);
  });

  it('null-поля не совпадают с userId (строгое ===)', () => {
    const tasks = [makeTask({ id: 'nulls', assigned_to: null, created_by: null })];
    expect(filterTasksForUser(tasks, 'me')).toEqual([]);
  });

  it('выполненная задача (done) фильтруется так же — только своя', () => {
    // Колонка не влияет на фильтр: свой done виден, чужой — нет
    // (колонка — ответственность StreamView/groupByColumn, не фильтра).
    const mine = makeTask({ id: 'mine-done', assigned_to: 'me' });
    const foreign = makeTask({ id: 'foreign-done', assigned_to: 'w-1' });
    expect(filterTasksForUser([mine, foreign], 'me').map((t) => t.id)).toEqual(['mine-done']);
  });

  it('админ фильтруется так же, как обычный участник (исключений нет)', () => {
    const tasks = [
      makeTask({ id: 'foreign', assigned_to: 'w-1', created_by: 'w-2' }),
      makeTask({ id: 'mine', created_by: 'admin' }),
    ];
    // Роль сознательно не передаётся — сигнатура её не принимает.
    expect(filterTasksForUser(tasks, 'admin').map((t) => t.id)).toEqual(['mine']);
  });

  it('текущий пользователь не определён → все задачи (boot-фаза, без фильтра)', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b', assigned_to: 'w-1' })];
    expect(filterTasksForUser(tasks, undefined)).toBe(tasks);
    expect(filterTasksForUser(tasks, null)).toBe(tasks);
    expect(filterTasksForUser(tasks, '')).toBe(tasks);
  });

  it('пустой список → пустой список', () => {
    expect(filterTasksForUser([], 'me')).toEqual([]);
  });
});