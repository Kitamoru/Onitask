// Tests for src/lib/sprintSummary.ts — BOARD-AGG: сводка спринта per workspace.
// Чистая функция — node-env, без моков.

import { describe, it, expect } from 'vitest';
import { buildSprintsByWorkspace } from '../../src/lib/sprintSummary';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayAt(hoursFromNowMidnightOffsetDays: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + hoursFromNowMidnightOffsetDays);
  return d;
}

const baseSprint = {
  workspace_id: 'ws-1',
  name: 'Sprint 1',
  goal: 'Ship BOARD-AGG',
  status: 'active',
  start_date: null,
  end_date: null,
};

describe('buildSprintsByWorkspace', () => {
  it('пустой вход → пустой результат', () => {
    expect(buildSprintsByWorkspace([])).toEqual({});
  });

  it('строки без workspace_id пропускаются', () => {
    const result = buildSprintsByWorkspace([{ ...baseSprint, workspace_id: null }]);
    expect(result).toEqual({});
  });

  it('берёт первый (самый свежий) спринт per workspace', () => {
    const result = buildSprintsByWorkspace([
      { ...baseSprint, name: 'newest' },
      { ...baseSprint, name: 'older', status: 'planning' },
    ]);
    expect(result['ws-1'].name).toBe('newest');
    expect(result['ws-1'].isActive).toBe(true);
  });

  it('разделяет спринты по workspace', () => {
    const result = buildSprintsByWorkspace([
      { ...baseSprint, workspace_id: 'ws-1', name: 'A' },
      { ...baseSprint, workspace_id: 'ws-2', name: 'B' },
    ]);
    expect(result['ws-1'].name).toBe('A');
    expect(result['ws-2'].name).toBe('B');
  });

  it('daysElapsed/totalDays считаются от start/end (7-дневный, прошедло 3)', () => {
    const start = dayAt(-2);
    const end = dayAt(+4);
    const result = buildSprintsByWorkspace([
      { ...baseSprint, start_date: iso(start), end_date: iso(end) },
    ]);
    expect(result['ws-1'].totalDays).toBe(7);
    expect(result['ws-1'].daysElapsed).toBe(3);
  });

  it('спринт не начался → daysElapsed = 0', () => {
    const start = dayAt(+1);
    const end = dayAt(+7);
    const result = buildSprintsByWorkspace([
      { ...baseSprint, status: 'planning', start_date: iso(start), end_date: iso(end) },
    ]);
    expect(result['ws-1'].daysElapsed).toBe(0);
  });

  it('без дат → дефолт 0/7', () => {
    const result = buildSprintsByWorkspace([baseSprint]);
    expect(result['ws-1'].daysElapsed).toBe(0);
    expect(result['ws-1'].totalDays).toBe(7);
  });

  it('goal маппится в topic, planning → isActive=false', () => {
    const result = buildSprintsByWorkspace([
      { ...baseSprint, status: 'planning', goal: 'Цель' },
    ]);
    expect(result['ws-1'].topic).toBe('Цель');
    expect(result['ws-1'].isActive).toBe(false);
  });
});
