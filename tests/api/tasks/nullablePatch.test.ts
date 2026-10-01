// SUB-01: PATCH /api/tasks/[id] — явный `null` как «снять поле».
//
// Регрессия, которую закрывает файл: роут отбрасывал `null` и `undefined`
// одним условием `if (body[field] != null)`. В UI есть «Без исполнителя» и
// снятый срок, но запрос уходил, PATCH его игнорировал, UI рапортовал об
// успехе — и ничего не писало. Ровно тот класс «молчаливый успех», о котором
// AGENTS.md §5 и предупреждает.
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

import { PATCH } from '@/app/api/tasks/[id]/route';
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

/** Пayload, реально ушедший в supabase `.update(...)`. */
let capturedUpdate: Record<string, unknown> | null = null;

const makeTask = (over: Partial<TaskPick> = {}): TaskPick => ({
  workspace_id: 'ws-1',
  column: 'in_progress',
  version: 1,
  created_by: 'worker-me',
  assigned_to: 'worker-me',
  reviewer_id: null,
  metadata: {},
  ...over,
});

function buildSupabase(taskRow: TaskPick) {
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const passthrough = [
      'select', 'insert', 'upsert', 'delete', 'eq', 'neq', 'in',
      'or', 'order', 'limit', 'range', 'is', 'not', 'filter', 'lte', 'gte',
    ];
    for (const m of passthrough) chain[m] = () => chain;
    chain.update = (payload: Record<string, unknown>) => {
      capturedUpdate = payload;
      return chain;
    };
    chain.single = () => Promise.resolve({ data: taskRow, error: null });
    chain.maybeSingle = () => Promise.resolve({ data: taskRow, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return chain;
  };

  return {
    from: () => makeChain(),
    storage: { from: () => ({ remove: vi.fn(() => Promise.resolve()) }) },
    channel: () => ({ send: vi.fn(() => Promise.resolve()) }),
  } as unknown as ReturnType<typeof createServerClient>;
}

function mockRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

function setup(task: TaskPick) {
  const actor = {
    id: 'worker-me',
    workspace_id: task.workspace_id,
    source_id: 'profile-1',
    type: 'human',
    role: 'member',
  };
  vi.mocked(authenticateRequest).mockResolvedValue({
    authenticated: true,
    profileId: 'profile-1',
    displayName: 'Tester',
  });
  vi.mocked(extractInitData).mockResolvedValue('init-data');
  vi.mocked(isWorkspaceMember).mockResolvedValue(true);
  vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor as never);
  vi.mocked(getTaskWritePermission).mockResolvedValue(
    getTaskPermission(
      {
        created_by: task.created_by,
        assigned_to: task.assigned_to,
        column: task.column,
      },
      { workerId: 'worker-me', role: 'member' },
    ),
  );
  vi.mocked(createServerClient).mockReturnValue(buildSupabase(task));
}

async function patchWith(
  body: Record<string, unknown>,
  task: TaskPick = makeTask(),
): Promise<Record<string, unknown>> {
  capturedUpdate = null;
  setup(task);
  const res = await PATCH(mockRequest(body), {
    params: Promise.resolve({ id: 'task-1' }),
  } as never);
  expect(res.status).toBe(200);
  return capturedUpdate ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdate = null;
});

describe('PATCH: явный null снимает nullable-поле', () => {
  it('assigned_to: null очищает исполнителя', async () => {
    // Главный симптом: в списке выбора есть «Без исполнителя», PATCH его
    // проглатывал, а UI показывал «Сохранено».
    const update = await patchWith({ assigned_to: null });
    expect(update.assigned_to).toBeNull();
  });

  it('deadline: null очищает срок', async () => {
    const update = await patchWith({ deadline: null });
    expect(update.deadline).toBeNull();
  });

  it('reviewer_id: null снимает проверяющего (решение владельца)', async () => {
    const update = await patchWith({ reviewer_id: null });
    expect(update.reviewer_id).toBeNull();
  });

  it('не переданное поле не трогается вовсе', async () => {
    // `undefined` — «не передано», его нельзя превращать в null: иначе PATCH
    // без срока обнулял бы чужое поле.
    const update = await patchWith({ title: 'Новое имя' });
    expect('deadline' in update).toBe(false);
    expect('assigned_to' in update).toBe(false);
  });
});

describe('PATCH: NOT NULL-колонки null-ом не пишем', () => {
  // Возврат прежнего `!= null` здесь роняет эти тесты — в этом их смысл.
  it('title: null отбрасывается, а не уходит в БД', async () => {
    const update = await patchWith({ title: null });
    expect('title' in update).toBe(false);
  });

  it('column: null отбрасывается', async () => {
    const update = await patchWith({ column: null });
    expect('column' in update).toBe(false);
  });

  it('metadata: null отбрасывается — иначе стёрлись бы external_links', async () => {
    const update = await patchWith({ metadata: null });
    expect('metadata' in update).toBe(false);
  });

  it('cognitive_weight: null отбрасывается (NOT NULL number)', async () => {
    const update = await patchWith({ cognitive_weight: null });
    expect('cognitive_weight' in update).toBe(false);
  });

  it('description: null отбрасывается — решение владельца (2026-10-01)', async () => {
    // Снятие описания оставили как есть, даже при явном null.
    const update = await patchWith({ description: null });
    expect('description' in update).toBe(false);
  });
});

describe('PATCH: обычные значения не сломаны', () => {
  it('title и column доезжают как есть', async () => {
    const update = await patchWith({ title: 'Починить ленту', column: 'review' });
    expect(update.title).toBe('Починить ленту');
    expect(update.column).toBe('review');
  });

  it('version инкрементируется поверх любых правок', async () => {
    const update = await patchWith({ assigned_to: null });
    expect(update.version).toBe(2);
  });
});
