// SUB-01: права на удаление подзадачи и запрет агента-исполнителя в PATCH.
//
// Регрессия, которую закрывают эти тесты:
//   1. DELETE считал права по created_by САМОЙ подзадачи. Создал подзадачу админ
//      в чужой задаче — автор задачи терял право её удалить (403), при этом UI
//      показывал кнопку по правам на РОДИТЕЛЕ. Обратный случай: исполнитель
//      родителя (canEdit=true, canDelete=false) видел кнопку и получал 403.
//   2. PATCH /api/tasks/[id] не проверял тип исполнителя, поэтому подзадаче
//      можно было назначить агента. trg_dispatch_outbox_on_assign тогда клал
//      подзадачу в dispatch_outbox, и агент получал её в работу в обход
//      `.is('parent_task_id', null)` в getTasksByColumn.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  extractInitData: vi.fn(),
  isWorkspaceMember: vi.fn(),
  getActiveWorkerInWorkspace: vi.fn(),
  getTaskWritePermission: vi.fn(),
}));
vi.mock('@core/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@core/taskEnrichment', () => ({ enrichTaskRow: vi.fn((r: unknown) => r) }));

import { PATCH, DELETE } from '@/app/api/tasks/[id]/route';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
  getActiveWorkerInWorkspace,
  getTaskWritePermission,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';
import { getTaskPermission } from '@/lib/taskPermissions';

const PARENT = {
  id: 'parent-1',
  workspace_id: 'ws-1',
  column: 'in_progress',
  created_by: 'task-author',
  assigned_to: null,
  parent_task_id: null,
};
const SUBTASK = {
  id: 'subtask-1',
  workspace_id: 'ws-1',
  column: 'backlog',
  created_by: 'admin-who-added', // админ нажал «добавить подзадачу»
  assigned_to: null,
  parent_task_id: 'parent-1',
};

type Row = Record<string, unknown>;

/**
 * Мок, различающий строки по id: `eq('id', X)` решает, какая строка вернётся.
 * Без этого невозможно проверить, что DELETE считает права по РОДИТЕЛЮ, а не по
 * подзадаче — а именно это и есть проверяемое поведение.
 */
function buildSupabase(rows: Record<string, Row>, workers: Row[] = []) {
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    let eqId: string | null = null;
    const passthrough = [
      'select', 'insert', 'update', 'upsert', 'delete', 'in',
      'or', 'order', 'limit', 'range', 'is', 'not', 'filter', 'lte', 'gte', 'neq',
    ];
    for (const m of passthrough) chain[m] = () => chain;
    chain.eq = (column: string, value: unknown) => {
      if (column === 'id') eqId = String(value);
      return chain;
    };
    const single = async () => ({
      data: eqId && rows[eqId] ? rows[eqId] : null,
      error: null,
    });
    chain.single = single;
    chain.maybeSingle = single;
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return chain;
  };

  return {
    from: (table: string) => {
      if (table === 'workers') {
        const chain: Record<string, unknown> = {};
        let eqId: string | null = null;
        chain.select = () => chain;
        chain.eq = (_c: string, v: unknown) => {
          eqId = String(v);
          return chain;
        };
        chain.maybeSingle = async () => ({
          data: workers.find((w) => w.id === eqId) ?? null,
          error: null,
        });
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        return chain;
      }
      return makeChain();
    },
    storage: { from: () => ({ remove: vi.fn(() => Promise.resolve()) }) },
    channel: () => ({ send: vi.fn(() => Promise.resolve()) }),
  } as unknown as ReturnType<typeof createServerClient>;
}

function mockRequest(body: Record<string, unknown> = {}) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

/** Права считаем НАСТОЯЩИМ правилом по тем аргументам, которые роут передал. */
function setupActor(workerId: string, role: string | null) {
  vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({
    id: workerId,
    workspace_id: 'ws-1',
    source_id: 'profile-1',
    type: 'human',
    role,
  } as never);
  vi.mocked(getTaskWritePermission).mockImplementation(async (_p, task) =>
    getTaskPermission(
      { created_by: task.created_by, assigned_to: task.assigned_to, column: task.column },
      { workerId, role },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateRequest).mockResolvedValue({
    authenticated: true,
    profileId: 'profile-1',
  } as never);
  vi.mocked(extractInitData).mockResolvedValue('init' as never);
  vi.mocked(isWorkspaceMember).mockResolvedValue(true);
});

describe('DELETE подзадачи — права по РОДИТЕЛЮ (SUB-01)', () => {
  const params = { params: Promise.resolve({ id: 'subtask-1' }) };

  it('автор задачи удаляет подзадачу, добавленную админом', async () => {
    // До фикса: 403, потому что created_by подзадачи = админ, а не автор задачи.
    setupActor('task-author', 'member');
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ 'subtask-1': SUBTASK, 'parent-1': PARENT }),
    );
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(200);
  });

  it('права передаются в getTaskWritePermission от РОДИТЕЛЯ', async () => {
    // Проверяем не только код ответа, но и ЧТО именно роут отдал правилам:
    // иначе тест проходил бы и при случайно верном исходе.
    setupActor('task-author', 'member');
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ 'subtask-1': SUBTASK, 'parent-1': PARENT }),
    );
    await DELETE(mockRequest(), params);
    expect(vi.mocked(getTaskWritePermission).mock.calls[0]?.[1]).toMatchObject({
      created_by: 'task-author',
    });
  });

  it('исполнитель родителя правит, но удалить подзадачу не может', async () => {
    // UI прячет кнопку по canDelete — роут и правило должны сходиться.
    setupActor('executor-of-parent', 'member');
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({
        'subtask-1': { ...SUBTASK, assigned_to: 'executor-of-parent' },
        'parent-1': { ...PARENT, assigned_to: 'executor-of-parent' },
      }),
    );
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(403);
  });

  it('админ удаляет любую подзадачу', async () => {
    setupActor('admin-who-added', 'admin');
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ 'subtask-1': SUBTASK, 'parent-1': PARENT }),
    );
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(200);
  });

  it('родитель исчез (гонка с CASCADE) → права по самой подзадаче, не молчание', async () => {
    setupActor('admin-who-added', 'member'); // created_by подзадачи = он же
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ 'subtask-1': SUBTASK }), // parent-1 отсутствует
    );
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(200);
  });
});

describe('PATCH подзадачи — агент-исполнитель запрещён (SUB-01, v1)', () => {
  const params = { params: Promise.resolve({ id: 'subtask-1' }) };
  const human = { id: 'human-1', type: 'human', is_active: true, workspace_id: 'ws-1' };
  const agent = { id: 'agent-1', type: 'agent', is_active: true, workspace_id: 'ws-1' };

  it('400: подзадаче нельзя назначить агента', async () => {
    // Регрессия: PATCH не проверял тип, и trg_dispatch_outbox_on_assign отдавал
    // подзадачу агенту в работу.
    setupActor('task-author', 'member');
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ 'subtask-1': SUBTASK, 'parent-1': PARENT }, [human, agent]),
    );
    const res = await PATCH(mockRequest({ assigned_to: 'agent-1' }), params);
    expect(res.status).toBe(400);
  });

  it('200: подзадаче можно назначить активного человека', async () => {
    setupActor('task-author', 'member');
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ 'subtask-1': SUBTASK, 'parent-1': PARENT }, [human, agent]),
    );
    const res = await PATCH(mockRequest({ assigned_to: 'human-1' }), params);
    expect(res.status).toBe(200);
  });

  it('самостоятельной задаче агента назначать можно — правило только для подзадач', async () => {
    setupActor('task-author', 'member');
    // created_by = сам actor: иначе canEdit=false и роут отклонит раньше,
    // чем дойдёт до проверки типа исполнителя, и тест прошёл бы вхолостую.
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase(
        {
          'subtask-1': {
            ...SUBTASK,
            parent_task_id: null,
            created_by: 'task-author',
          },
        },
        [human, agent],
      ),
    );
    const res = await PATCH(mockRequest({ assigned_to: 'agent-1' }), params);
    expect(res.status).toBe(200);
  });
});

