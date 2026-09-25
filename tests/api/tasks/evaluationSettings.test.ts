// Regression tests for workspace evaluation gates in the task API.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  extractInitData: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
  isWorkspaceMember: vi.fn(),
  getActiveWorkerInWorkspace: vi.fn(),
  // TASK-PERM: права на запись в задачу. Эти тесты проверяют evaluation-гейты
  // (cognitive_weight / story_points), а не модель прав, поэтому по умолчанию
  // права выдаём — иначе PATCH отсекался бы новой проверкой canEdit.
  getTaskWritePermission: vi.fn(),
}));
vi.mock('@core/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@core/taskEnrichment', () => ({
  enrichTaskRow: vi.fn(async (row: unknown) => row),
  enrichTaskRowsBatch: vi.fn(async (rows: unknown[]) => rows),
}));

import { POST } from '@/app/api/tasks/route';
import { PATCH } from '@/app/api/tasks/[id]/route';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
  getDefaultWorkspaceId,
  getTaskWritePermission,
  isWorkspaceMember,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';
import { enrichTaskRow } from '@core/taskEnrichment';

type Settings = { enable_cognitive_budget: boolean; story_points_config: Record<string, unknown> };
type TaskRow = Record<string, unknown>;

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body, headers: { get: () => 'init-data' } } as unknown as NextRequest;
}

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.upsert = vi.fn(async () => ({ error: null }));
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  return chain;
}

function makeDb(settings: Settings, task: TaskRow) {
  const enrichmentUpsert = vi.fn(async () => ({ error: null }));
  const taskInsert = vi.fn(() => query({ data: task, error: null }));
  const taskUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: task, error: null })) })) })),
    })),
  }));
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'workspace_settings') {
        return query({ data: settings, error: null });
      }
      if (table === 'tasks') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: task, error: null })),
            })),
          })),
          insert: taskInsert,
          update: taskUpdate,
        };
      }
      if (table === 'task_enrichments') {
        return { upsert: enrichmentUpsert };
      }
      return {};
    }),
    channel: vi.fn(() => ({ send: vi.fn(async () => undefined) })),
  };
  return { db: db as unknown as ReturnType<typeof createServerClient>, enrichmentUpsert, taskInsert, taskUpdate };
}

const baseTask: TaskRow = {
  id: 'task-1', workspace_id: 'ws-1', version: 1, column: 'backlog', reviewer_id: null,
  created_by: 'worker-1', metadata: null,
};

describe('task API evaluation gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: true, profileId: 'profile-1' });
    vi.mocked(getDefaultWorkspaceId).mockResolvedValue('ws-1');
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'worker-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'human', role: 'member' });
    // TASK-PERM: полные права по умолчанию (см. комментарий к моку выше).
    vi.mocked(getTaskWritePermission).mockResolvedValue({
      isAdmin: false, isCreator: true, isAssignee: false,
      canEdit: true, canDelete: true, canClaim: false,
    });
  });

  it('rejects hidden CW and SP values on create', async () => {
    const { db } = makeDb({ enable_cognitive_budget: false, story_points_config: { enabled: false } }, baseTask);
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await POST(request({ title: 'Task', workspace_id: 'ws-1', cognitive_weight: 2, story_points: 5 }));
    expect(response.status).toBe(400);
  });

  it('persists a valid manual SP in task_enrichments on create', async () => {
    const { db, enrichmentUpsert } = makeDb({ enable_cognitive_budget: true, story_points_config: { enabled: true, values: [1, 2, 3, 5, 8] } }, baseTask);
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await POST(request({ title: 'Task', workspace_id: 'ws-1', story_points: 5 }));
    expect(response.status).toBe(201);
    expect(enrichmentUpsert).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'task-1', story_points: 5 }));
    expect(await response.json()).toMatchObject({ task: { story_points: 5 } });
  });

  it('rejects hidden values on PATCH before updating the task', async () => {
    const { db, taskUpdate } = makeDb({ enable_cognitive_budget: false, story_points_config: { enabled: false } }, baseTask);
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await PATCH(
      request({ story_points: 5 }),
      { params: Promise.resolve({ id: 'task-1' }) },
    );
    expect(response.status).toBe(400);
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('persists a valid manual SP on PATCH after the task update', async () => {
    const { db, enrichmentUpsert } = makeDb({ enable_cognitive_budget: true, story_points_config: { enabled: true, values: [1, 2, 3, 5, 8] } }, baseTask);
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await PATCH(
      request({ title: 'Updated', story_points: 8 }),
      { params: Promise.resolve({ id: 'task-1' }) },
    );
    expect(response.status).toBe(200);
    expect(enrichmentUpsert).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'task-1', story_points: 8 }));
    expect(vi.mocked(enrichTaskRow)).toHaveBeenCalled();
  });
});
