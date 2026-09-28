// Tests for PATCH /api/tasks/[id] — REV-02 (обход назначенного ревьюера).
//
// Ключевое: тест ВЫЗЫВАЕТ реальный обработчик, а не ищет текст гварда в файле.
// Регресс-причина — ложнозелёные текстовые проверки из AGENTS.md §5: комментарий
// «REV-02» удовлетворяет /isReviewBypassBlocked/ в исходнике, даже если проверка
// отключена в рантайме. Здесь блокировка подтверждается статусом 403 И тем, что
// update в БД не вызывался.

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
import { REVIEW_BYPASS_BLOCKED } from '@/lib/reviewDecision';

type TaskPick = {
  id: string;
  workspace_id: string;
  column: string;
  version: number;
  created_by: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  metadata: Record<string, unknown> | null;
};

const makeTask = (over: Partial<TaskPick> = {}): TaskPick => ({
  id: 'task-1',
  workspace_id: 'ws-1',
  column: 'review',
  version: 1,
  created_by: 'creator-1',
  assigned_to: 'assignee-1',
  reviewer_id: 'reviewer-1',
  metadata: {},
  ...over,
});

function mockRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** Мок клиента: `update` — spy, чтобы доказать, что запись не дошла до БД. */
function buildSupabase(taskRow: TaskPick) {
  const updateSpy = vi.fn();
  const client = {
    from: (table: string) => {
      if (table === 'workspace_settings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: taskRow, error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => {
          updateSpy(payload);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { ...payload }, error: null }),
                }),
              }),
            }),
          };
        },
      };
    },
  };
  return { client: client as never, updateSpy };
}

const actor = (id: string, role: string) => ({
  id,
  workspace_id: 'ws-1',
  source_id: 'profile-1',
  type: 'telegram',
  role,
});


describe('PATCH /api/tasks/[id] — REV-02 (обход назначенного ревьюера)', () => {
  const params = { params: Promise.resolve({ id: 'task-1' }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
      displayName: 'Tester',
    });
    // Исполнитель проходит canEdit — именно поэтому старая проверка прав
    // дыру не закрывала.
    vi.mocked(getTaskWritePermission).mockResolvedValue({
      canEdit: true,
      canClaim: false,
    } as never);
  });

  it('исполнитель с назначенным ревьюером: review → done = 403, записи в БД нет', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('assignee-1', 'executor') as never);
    const { client, updateSpy } = buildSupabase(makeTask());
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: REVIEW_BYPASS_BLOCKED });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('автор задачи с назначенным ревьюером: тоже 403', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('creator-1', 'executor') as never);
    const { client, updateSpy } = buildSupabase(makeTask());
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('назначенный ревьюер: 200, запись проходит', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('reviewer-1', 'reviewer') as never);
    const { client, updateSpy } = buildSupabase(makeTask());
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('admin форс-мейджит: 200', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('admin-1', 'admin') as never);
    const { client } = buildSupabase(makeTask());
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(200);
  });

  it('owner форс-мейджит: 200', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('owner-1', 'owner') as never);
    const { client } = buildSupabase(makeTask());
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(200);
  });

  it('задача НЕ в review (in_progress → done) с ревьюером: 200 — правило не применяется', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('assignee-1', 'executor') as never);
    const { client, updateSpy } = buildSupabase(makeTask({ column: 'in_progress' }));
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('ревьюер НЕ назначен: прежнее поведение сохранено, новый гвард не мешает', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('creator-1', 'executor') as never);
    const { client, updateSpy } = buildSupabase(makeTask({ reviewer_id: null }));
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'done' }), params);

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('переход в другую колонку (review → in_progress) исполнителем: 200, не блокируется', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(actor('assignee-1', 'executor') as never);
    const { client, updateSpy } = buildSupabase(makeTask());
    vi.mocked(createServerClient).mockReturnValue(client);

    const res = await PATCH(mockRequest({ column: 'in_progress' }), params);

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
