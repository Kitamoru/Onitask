import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SUB-01: display-id подзадачи собирается серверным обогащением.
 *
 * Почему этот тест, а не только buildFullId: `enrichTaskRowsBatch` собирал
 * `full_id` руками (`prefix && task_number ? ... : id.slice(0,8)`) мимо общей
 * функции. У подзадачи `task_number = NULL`, поэтому в шапке шторки появлялось
 * «Подзадача 8a35e04c» — владелец это и заметил. Тест на саму функцию такую
 * расхождённость поймать не мог: функция была исправна, её просто не звали.
 *
 * Здесь проверяется РЕАЛЬНЫЙ вызов обогащения, а не текст исходника.
 */

const tables: Record<string, unknown[]> = {
  workspaces: [{ id: 'ws-1', task_prefix: 'ONI', name: 'Onitask' }],
  workers: [],
  tasks: [{ id: 'parent-1', task_number: 42 }],
};

vi.mock('@core/supabase', () => ({
  createServerClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ data: tables[table] ?? [] }),
        eq: () => ({ single: async () => ({ data: null }) }),
      }),
    }),
  })),
}));

const { enrichTaskRowsBatch } = await import('@core/taskEnrichment');

const baseRow = {
  workspace_id: 'ws-1',
  title: 'Подзадача',
  description: null,
  tags: [],
  column: 'backlog',
  priority: 'medium',
  deadline: null,
  deadline_urgency: null,
  is_inbox: false,
  is_blocked: false,
  needs_human: false,
  escalation_reason: null,
  assigned_to: null,
  reviewer_id: null,
  handoff_to: null,
  handoff_notes: null,
  sprint_id: null,
  cognitive_weight: 0,
  raw_input: null,
  clarity_score: null,
  complexity: null,
  enrichment_strategy: null,
  version: 1,
  moved_to_column_at: null,
  position: 0,
  source: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: null,
};

beforeEach(() => {
  tables.workspaces = [{ id: 'ws-1', task_prefix: 'ONI', name: 'Onitask' }];
  tables.tasks = [{ id: 'parent-1', task_number: 42 }];
});

describe('enrichTaskRowsBatch: full_id подзадачи', () => {
  it('подзадача → «ONI-42-SUB-2», а не hex от UUID', async () => {
    const [row] = await enrichTaskRowsBatch([
      {
        ...baseRow,
        id: 'sub-uuid-1111',
        task_number: null,
        parent_task_id: 'parent-1',
        subtask_index: 2,
      },
    ] as never);

    expect(row.full_id).toBe('ONI-42-SUB-2');
    // Ровно та же форма, что у серверного RPC task_full_id (миграция 139) —
    // значит веб и Telegram-карточка называют один пункт одинаково.
    expect(row.full_id).not.toContain('sub-uuid');
  });

  it('подзадача теряет связь с родителем, если её не отдать в EnrichedTask', async () => {
    const [row] = await enrichTaskRowsBatch([
      {
        ...baseRow,
        id: 'sub-uuid-1111',
        task_number: null,
        parent_task_id: 'parent-1',
        subtask_index: 2,
      },
    ] as never);

    expect(row.parent_task_id).toBe('parent-1');
    expect(row.subtask_index).toBe(2);
  });

  it('самостоятельная задача не ломается: «ONI-42»', async () => {
    const [row] = await enrichTaskRowsBatch([
      { ...baseRow, id: 'task-uuid-2222', task_number: 42, parent_task_id: null, subtask_index: null },
    ] as never);

    expect(row.full_id).toBe('ONI-42');
  });

  it('родитель в одной пачке с подзадачей не мешает общей выборке номеров', async () => {
    // Один запрос на пачку: если бы номера родителей тянулись по одной на
    // строку, здесь был бы N+1. Проверяем, что оба id собраны верно.
    const rows = await enrichTaskRowsBatch([
      { ...baseRow, id: 'task-uuid-2222', task_number: 42, parent_task_id: null, subtask_index: null },
      {
        ...baseRow,
        id: 'sub-uuid-1111',
        task_number: null,
        parent_task_id: 'task-uuid-2222',
        subtask_index: 1,
      },
    ] as never);

    // task-uuid-2222 = сам родитель из второй подзадачи, номера у него в
    // таблицах нет — сработает ветка «номер родителя неизвестен».
    expect(rows[0].full_id).toBe('ONI-42');
    expect(rows[1].full_id).toBe('ONI-SUB-1');
  });
});
