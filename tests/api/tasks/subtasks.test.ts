// Tests for POST/GET /api/tasks/[id]/subtasks — SUB-01 (node-env, mock-based).
//
// Проверяем связку «route + правила из @/lib/subtasks», а не заранее зашитый
// результат мока: права считаются реальной чистой функцией getTaskPermission.
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
  enrichTaskRowsBatch: vi.fn(async (rows: unknown[]) => rows),
  enrichTaskRow: vi.fn((row: unknown) => row),
}));

import { POST, GET } from '@/app/api/tasks/[id]/subtasks/route';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
  getActiveWorkerInWorkspace,
  getTaskWritePermission,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';
import { getTaskPermission } from '@/lib/taskPermissions';
import {
  SUBTASK_FORBIDDEN_ASSIGNEE,
  SUBTASK_LIMIT_REACHED,
  SUBTASK_PARENT_IS_SUBTASK,
  SUBTASK_TITLE_REQUIRED,
} from '@/lib/subtasks';

type ParentPick = {
  id: string;
  workspace_id: string;
  parent_task_id: string | null;
  created_by: string | null;
  assigned_to: string | null;
  column: string;
};

const PARENT: ParentPick = {
  id: 'task-1',
  workspace_id: 'ws-1',
  parent_task_id: null,
  created_by: '11111111-1111-4111-8111-111111111111', // автор-человек
  assigned_to: null,
  column: 'backlog',
};

const ME = '22222222-2222-4222-8222-222222222222'; // текущий пользователь
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';

type WorkerRow = {
  id: string;
  type: 'human' | 'agent';
  is_active: boolean;
  workspace_id: string;
};

/**
 * Мок supabase. Отличается от соседних тестов тремя вещами:
 *  · `workers` отдаёт строку ПО ЗАПРОШЕННОМУ id (eq-фильтр учитывается) —
 *    иначе «исполнитель» и «автор родителя» нельзя развести;
 *  · запрос `tasks` с `.select('subtask_index')` отдаёт список подзадач,
 *    остальные — сам родитель;
 *  · `insert` считается в `__state.inserts`, чтобы тест лимита 10 мог
 *    доказать, что попытки вставки не было вовсе.
 */
function buildSupabase(
  options: {
    workers?: WorkerRow[];
    siblings?: Array<{ subtask_index: number | null }>;
    parent?: ParentPick | null;
  } = {},
) {
  const workers = options.workers ?? [];
  const siblings = options.siblings ?? [];
  const parent = options.parent === undefined ? PARENT : options.parent;
  const state = { inserted: null as Record<string, unknown> | null, inserts: 0 };

  const makeChain = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    // Последний переданный id — по нему ищем строку workers.
    let eqId: string | null = null;
    const passthrough = ['select', 'update', 'upsert', 'delete', 'neq', 'in', 'or', 'order', 'limit', 'range', 'is', 'not', 'filter'];
    for (const m of passthrough) chain[m] = () => chain;
    chain.eq = (column: string, value: unknown) => {
      if (column === 'id') eqId = String(value);
      return chain;
    };
    chain.insert = (values: Record<string, unknown>) => {
      state.inserts += 1;
      state.inserted = { ...values, id: 'new-sub' };
      return chain;
    };
    chain.single = () =>
      Promise.resolve({ data: state.inserted ?? { id: 'new-sub' }, error: null });
    chain.maybeSingle = () =>
      Promise.resolve({
        data:
          table === 'workers'
            ? workers.find((w) => w.id === eqId) ?? null
            : parent,
        error: null,
      });
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === 'tasks' ? siblings : [], error: null });
    return chain;
  };

  const client = {
    from: (table: string) => makeChain(table),
    __state: state,
  };
  return client as unknown as ReturnType<typeof createServerClient> & {
    __state: typeof state;
  };
}

function mockRequest(body: Record<string, unknown> = {}) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: 'task-1' }) };

function setupAuth(overrides: { role?: string | null; workerId?: string } = {}) {
  // По умолчанию текущий пользователь = автор родителя, поэтому можетEdit.
  const workerId = overrides.workerId ?? PARENT.created_by!;
  const role = overrides.role ?? 'member';
  vi.mocked(extractInitData).mockResolvedValue('init-data');
  vi.mocked(authenticateRequest).mockResolvedValue({
    authenticated: true,
    profileId: 'profile-1',
  } as never);
  vi.mocked(isWorkspaceMember).mockResolvedValue(true);
  // Права — реальным чистым правилом, а не заранее зашитым моком.
  vi.mocked(getTaskWritePermission).mockResolvedValue(
    getTaskPermission(
      {
        created_by: PARENT.created_by,
        assigned_to: PARENT.assigned_to,
        column: PARENT.column,
      },
      { workerId, role },
    ),
  );
  vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({
    id: workerId,
    workspace_id: PARENT.workspace_id,
    source_id: 'profile-1',
    type: 'human',
    role,
  } as never);
}

describe('POST /api/tasks/[id]/subtasks — SUB-01', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it('создаёт подзадачу: автор задачи получает 201, ревьюер = автор родителя', async () => {
    const supabase = buildSupabase({
      // Автор родителя — человек: он и станет ревьюером подзадачи.
      workers: [
        { id: PARENT.created_by!, type: 'human', is_active: true, workspace_id: 'ws-1' },
        { id: ME, type: 'human', is_active: true, workspace_id: 'ws-1' },
      ],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(
      mockRequest({ title: 'Написать текст', assigned_to: ME }),
      params,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    // Ревьюер проставлен ИМЕННО автором родителя, а не NULL.
    expect(supabase.__state.inserted?.reviewer_id).toBe(PARENT.created_by);
    expect(supabase.__state.inserted?.parent_task_id).toBe('task-1');
    expect(supabase.__state.inserted?.assigned_to).toBe(ME);
  });

  it('reviewer_id = null, если автор родителя — агент (review_action требует human)', async () => {
    const supabase = buildSupabase({
      workers: [
        { id: PARENT.created_by!, type: 'agent', is_active: true, workspace_id: 'ws-1' },
        { id: ME, type: 'human', is_active: true, workspace_id: 'ws-1' },
      ],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(mockRequest({ title: 'Подзадача', assigned_to: ME }), params);

    expect(res.status).toBe(201);
    expect(supabase.__state.inserted?.reviewer_id).toBeNull();
  });

  it('403 — участник доски без прав не может создавать подзадачи', async () => {
    // Ни автор родителя, ни исполнитель, ни админ.
    setupAuth({ workerId: OUTSIDER_ID });
    vi.mocked(createServerClient).mockReturnValue(buildSupabase());

    const res = await POST(mockRequest({ title: 'Подзадача' }), params);
    expect(res.status).toBe(403);
  });

  it('400 — пустое содержание отклоняется', async () => {
    vi.mocked(createServerClient).mockReturnValue(buildSupabase());

    const res = await POST(mockRequest({ title: '   ' }), params);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(SUBTASK_TITLE_REQUIRED);
  });

  it('400 — агент не может быть исполнителем подзадачи (v1 только люди)', async () => {
    const supabase = buildSupabase({
      workers: [
        { id: AGENT_ID, type: 'agent', is_active: true, workspace_id: 'ws-1' },
        { id: PARENT.created_by!, type: 'human', is_active: true, workspace_id: 'ws-1' },
      ],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(
      mockRequest({ title: 'Подзадача', assigned_to: AGENT_ID }),
      params,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(SUBTASK_FORBIDDEN_ASSIGNEE);
  });

  it('404 — исполнитель из чужого воркспейса не раскрывается', async () => {
    const supabase = buildSupabase({
      workers: [
        { id: OUTSIDER_ID, type: 'human', is_active: true, workspace_id: 'ws-OTHER' },
        { id: PARENT.created_by!, type: 'human', is_active: true, workspace_id: 'ws-1' },
      ],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(
      mockRequest({ title: 'Подзадача', assigned_to: OUTSIDER_ID }),
      params,
    );
    expect(res.status).toBe(404);
  });

  it('400 — не-UUID исполнителя отклоняется до похода в БД', async () => {
    const supabase = buildSupabase({
      workers: [{ id: PARENT.created_by!, type: 'human', is_active: true, workspace_id: 'ws-1' }],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(
      mockRequest({ title: 'Подзадача', assigned_to: 'not-a-uuid' }),
      params,
    );
    expect(res.status).toBe(400);
    expect(supabase.__state.inserts).toBe(0);
  });

  it('400 — подзадача для подзадачи запрещена (один уровень вложенности)', async () => {
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ parent: { ...PARENT, parent_task_id: 'grandparent' } }),
    );

    const res = await POST(mockRequest({ title: 'Подзадача' }), params);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(SUBTASK_PARENT_IS_SUBTASK);
  });

  it('409 — 11-я подзадача отклоняется ДО INSERT (не 500 на CHECK)', async () => {
    const supabase = buildSupabase({
      siblings: Array.from({ length: 10 }, (_, i) => ({ subtask_index: i + 1 })),
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(mockRequest({ title: 'Одиннадцатая' }), params);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe(SUBTASK_LIMIT_REACHED);
    // Ни одной попытки вставки.
    expect(supabase.__state.inserts).toBe(0);
  });

  it('404 — задача чужого воркспейса не подтверждает своё существование', async () => {
    vi.mocked(isWorkspaceMember).mockResolvedValue(false);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase({ parent: null }));

    const res = await POST(mockRequest({ title: 'Подзадача' }), params);
    expect(res.status).toBe(404);
  });

  it('401 — без авторизации', async () => {
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: false,
      error: 'Не авторизован',
      status: 401,
    } as never);

    const res = await POST(mockRequest({ title: 'Подзадача' }), params);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/tasks/[id]/subtasks — описание подзадачи (SUB-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
    } as never);
    vi.mocked(extractInitData).mockResolvedValue('init' as never);
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({
      id: 'w-1',
      workspace_id: 'ws-1',
      type: 'human',
    } as never);
    vi.mocked(getTaskWritePermission).mockResolvedValue(
      getTaskPermission(
        { created_by: 'w-1', assigned_to: null, column: 'in_progress' },
        { workerId: 'w-1', role: 'member' },
      ),
    );
  });

  /**
   * Перехватываем реально уходящий INSERT через `__state.inserted` того же
   * мока, что и остальные тесты файла, — без второго, параллельного мока.
   */
  function setupInsertCapture(workers: WorkerRow[] = []) {
    const supabase = buildSupabase({ workers });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    return supabase;
  }

  const post = (body: Record<string, unknown>) =>
    POST(
      {
        json: async () => body,
        headers: { get: () => null },
      } as never,
      { params: Promise.resolve({ id: 'task-1' }) },
    );

  it('текст из «Что нужно сделать» сохраняется и в title, и в description', async () => {
    // Шторка подзадачи показывает description под заголовком «Подзадача»,
    // а список и TG-карточка — title. Одно поле ввода, две роли.
    const supabase = setupInsertCapture();
    await post({ title: 'Написать текст', description: 'Написать текст' });
    expect(supabase.__state.inserted).toMatchObject({
      title: 'Написать текст',
      description: 'Написать текст',
    });
  });

  it('без description отдаём title — старые вызовы не остаются без текста', async () => {
    const supabase = setupInsertCapture();
    await post({ title: 'Только название' });
    expect(supabase.__state.inserted?.description).toBe('Только название');
  });

  it('пустой description не затирает title', async () => {
    // Иначе подзадача выглядела бы созданной, но с пустым телом в шторке.
    const supabase = setupInsertCapture();
    await post({ title: 'Текст', description: '   ' });
    expect(supabase.__state.inserted?.description).toBe('Текст');
  });
});

describe('GET /api/tasks/[id]/subtasks — SUB-01', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it('возвращает список подзадач родителя', async () => {
    vi.mocked(createServerClient).mockReturnValue(buildSupabase());

    const res = await GET(mockRequest(), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.subtasks)).toBe(true);
  });
});
