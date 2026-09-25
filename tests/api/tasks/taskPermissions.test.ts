// Tests for PATCH/DELETE /api/tasks/[id] — TASK-PERM (node-env, mock-based).
// Регрессия: member мог править/удалять чужие задачи (проверялось только членство).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  extractInitData: vi.fn(),
  isWorkspaceMember: vi.fn(),
  getActiveWorkerInWorkspace: vi.fn(),
  getTaskWritePermission: vi.fn(),
}));
vi.mock('@core/supabase', () => ({
  createServerClient: vi.fn(),
}));
vi.mock('@core/taskEnrichment', () => ({
  enrichTaskRow: vi.fn((row: unknown) => row),
}));

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

type TaskPick = {
  workspace_id: string;
  column: string;
  version: number;
  created_by: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  metadata: Record<string, unknown>;
};

const makeTask = (over: Partial<TaskPick> = {}): TaskPick => ({
  workspace_id: 'ws-1',
  column: 'in_progress',
  version: 1,
  created_by: 'worker-other',
  assigned_to: null,
  reviewer_id: null,
  metadata: {},
  ...over,
});

/** Мок supabase: любая цепочка запросов возвращает строку задачи. */
function buildSupabase(taskRow: TaskPick) {
  // Fluent-цепочка: все методы-фильтры возвращают себя же, терминаторы
  // single/maybeSingle отдают строку задачи.
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const passthrough = [
      'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in',
      'or', 'order', 'limit', 'range', 'is', 'not', 'filter', 'lte', 'gte',
    ];
    for (const m of passthrough) chain[m] = () => chain;
    chain.single = () => Promise.resolve({ data: taskRow, error: null });
    chain.maybeSingle = () => Promise.resolve({ data: taskRow, error: null });
    // Запрос без терминатора (await chain) отдаёт пустой список — этим
    // отрабатывает чтение task_attachments в storage-чистке DELETE.
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return chain;
  };

  return {
    from: () => makeChain(),
    storage: {
      from: () => ({ remove: vi.fn(() => Promise.resolve()) }),
    },
    channel: () => ({ send: vi.fn(() => Promise.resolve()) }),
  } as unknown as ReturnType<typeof createServerClient>;
}

function mockRequest(body: Record<string, unknown> = {}) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

/**
 * Настроить мок так, чтобы getTaskWritePermission считал права по реальному
 * чистому правилу — тогда тесты проверяют связку «route + модель прав», а не
 * заранее зашитый результат мока.
 */
function setupPermission(
  role: string | null,
  task: TaskPick,
  workerId = 'worker-me',
) {
  const actor = {
    id: workerId,
    workspace_id: task.workspace_id,
    source_id: 'profile-1',
    type: 'human',
    role,
  };
  const perm = getTaskPermission(
    { created_by: task.created_by, assigned_to: task.assigned_to, column: task.column },
    { workerId, role },
  );
  vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor);
  vi.mocked(getTaskWritePermission).mockResolvedValue(perm);
  return perm;
}

describe('PATCH /api/tasks/[id] — TASK-PERM', () => {
  const params = { params: Promise.resolve({ id: 'task-1' }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
      displayName: 'Tester',
    });
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
  });

  it('403: member двигает чужую задачу, у которой он не автор и не исполнитель', async () => {
    const task = makeTask();
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ column: 'done' }), params);
    expect(res.status).toBe(403);
  });

  it('403: member правит чужую задачу (смена приоритета — не только column)', async () => {
    const task = makeTask();
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ priority: 'high' }), params);
    expect(res.status).toBe(403);
  });

  it('200: автор двигает и правит свою задачу', async () => {
    const task = makeTask({ created_by: 'worker-me' });
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ column: 'done' }), params);
    expect(res.status).toBe(200);
  });

  it('200: исполнитель двигает и правит задачу (но не автор)', async () => {
    const task = makeTask({ assigned_to: 'worker-me' });
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ column: 'done' }), params);
    expect(res.status).toBe(200);
  });

  it('200: owner форс-мейджит чужую задачу', async () => {
    const task = makeTask();
    setupPermission('owner', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ column: 'done' }), params);
    expect(res.status).toBe(200);
  });

  it('200: admin форс-мейджит чужую задачу', async () => {
    const task = makeTask();
    setupPermission('admin', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ column: 'done' }), params);
    expect(res.status).toBe(200);
  });

  it('200: self-claim — member берёт задачу из backlog себе (только assigned_to)', async () => {
    const task = makeTask({ column: 'backlog', assigned_to: null, created_by: 'worker-other' });
    const perm = setupPermission('member', task);
    expect(perm.canClaim).toBe(true);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ assigned_to: 'worker-me' }), params);
    expect(res.status).toBe(200);
  });

  it('403: self-claim запрещён вне backlog (in_progress без исполнителя)', async () => {
    const task = makeTask({ column: 'in_progress', assigned_to: null, created_by: 'worker-other' });
    const perm = setupPermission('member', task);
    expect(perm.canClaim).toBe(false);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ assigned_to: 'worker-me' }), params);
    expect(res.status).toBe(403);
  });

  it('403: self-claim нельзя совместить с правкой других полей', async () => {
    const task = makeTask({ column: 'backlog', assigned_to: null, created_by: 'worker-other' });
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(
      mockRequest({ assigned_to: 'worker-me', priority: 'high' }),
      params,
    );
    expect(res.status).toBe(403);
  });

  it('404 если профиль не состоит в workspace задачи (getTaskWritePermission → null)', async () => {
    const task = makeTask();
    vi.mocked(getTaskWritePermission).mockResolvedValue(null);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await PATCH(mockRequest({ column: 'done' }), params);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tasks/[id] — TASK-PERM', () => {
  const params = { params: Promise.resolve({ id: 'task-1' }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
      displayName: 'Tester',
    });
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
  });

  it('403: member удаляет чужую задачу', async () => {
    const task = makeTask();
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(403);
  });

  it('403: исполнитель НЕ может удалить задачу (может только править)', async () => {
    const task = makeTask({ assigned_to: 'worker-me' });
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(403);
  });

  it('200: автор удаляет свою задачу', async () => {
    const task = makeTask({ created_by: 'worker-me' });
    setupPermission('member', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(200);
  });

  it('200: owner удаляет чужую задачу', async () => {
    const task = makeTask();
    setupPermission('owner', task);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
    const res = await DELETE(mockRequest(), params);
    expect(res.status).toBe(200);
  });
});
