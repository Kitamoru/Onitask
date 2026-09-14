// Tests for POST /api/tasks/[id]/review — REV-01 (node-env, mock-based).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  extractInitData: vi.fn(),
  isWorkspaceMember: vi.fn(),
  getActiveWorkerInWorkspace: vi.fn(),
}));
vi.mock('@core/supabase', () => ({
  createServerClient: vi.fn(),
}));
vi.mock('@core/taskEnrichment', () => ({
  enrichTaskRow: vi.fn((row: unknown) => row),
}));

import { POST } from '@/app/api/tasks/[id]/review/route';
import {
  authenticateRequest, extractInitData, isWorkspaceMember,   getActiveWorkerInWorkspace,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';

type TaskPick = { workspace_id: string; column: string; version: number; created_by: string | null; reviewer_id: string | null };
const makeTask = (over: Partial<TaskPick> = {}): TaskPick =>
  ({ workspace_id: 'ws-1', column: 'review', version: 1, created_by: 'creator-1', reviewer_id: 'reviewer-1', ...over });

function mockRequest(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

function buildSupabase(
  taskRow: TaskPick,
  updatedRow: unknown,
  rpcResult: unknown,
): ReturnType<typeof createServerClient> {
  const maybeSingle = () => Promise.resolve({ data: taskRow, error: null });
  const single = () => Promise.resolve({ data: updatedRow, error: null });
  const eq = () => ({ maybeSingle, single });
  const select = () => ({ eq });
  return {
    from: () => ({ select }),
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
  } as unknown as ReturnType<typeof createServerClient>;
}

describe('POST /api/tasks/[id]/review — REV-01 (route)', () => {
  const params = { params: Promise.resolve({ id: 'task-1' }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: true, profileId: 'profile-1', displayName: 'Tester' });
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
  });

  it('401 при отсутствии initData', async () => {
    vi.mocked(extractInitData).mockResolvedValue(undefined);
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: false, error: 'missing_init_data', status: 401 });
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(401);
  });

  it('400 при недопустимом action', async () => {
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(makeTask(), {}, { data: null, error: null }));
    const res = await POST(mockRequest({ action: 'delete' }), params);
    expect(res.status).toBe(400);
  });

  it('400 при fix без причины', async () => {
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(makeTask(), {}, { data: null, error: null }));
    const res = await POST(mockRequest({ action: 'fix', reason: '' }), params);
    expect(res.status).toBe(400);
  });

  it('403 если профиль не член воркспейса', async () => {
    vi.mocked(isWorkspaceMember).mockResolvedValue(false);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(makeTask(), {}, { data: null, error: null }));
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(403);
  });

  it('403 если активный воркер не найден', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue(null);
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(makeTask(), {}, { data: null, error: null }));
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(403);
  });

  it('403 если актор не имеет прав (роль executor, не reviewer/creator)', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'executor-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'telegram', role: 'executor' });
    vi.mocked(createServerClient).mockReturnValue(buildSupabase(makeTask(), {}, { data: null, error: null }));
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(403);
  });
    it('approve → 200, RPC вызывается с p_action=approve, new_column=done', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'reviewer-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'telegram', role: 'reviewer' });
    const supabase = buildSupabase(makeTask(), { id: 'task-1', column: 'done' }, { data: { success: true, new_column: 'done' }, error: null });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('review_action', {
      p_task_id: 'task-1', p_action: 'approve', p_version: 1, p_actor_worker_id: 'reviewer-1', p_reason: undefined,
    });
  });

  it('fix с причиной → 200, RPC p_action=fix + p_reason (backfill-creator)', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'creator-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'telegram', role: 'executor' });
    const supabase = buildSupabase(makeTask({ reviewer_id: null }), { id: 'task-1', column: 'in_progress' }, { data: { success: true, new_column: 'in_progress' }, error: null });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(mockRequest({ action: 'fix', reason: 'needs rewrite' }), params);
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('review_action', {
      p_task_id: 'task-1', p_action: 'fix', p_version: 1, p_actor_worker_id: 'creator-1', p_reason: 'needs rewrite',
    });
  });

  it('409 на конфликт версии от RPC', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'reviewer-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'telegram', role: 'reviewer' });
    const supabase = buildSupabase(makeTask(), {}, { data: null, error: { message: 'version_conflict' } });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(409);
  });

  it('admin форс-мейджит: может решать чужую задачу', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'admin-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'telegram', role: 'admin' });
    const supabase = buildSupabase(makeTask(), { id: 'task-1', column: 'done' }, { data: { success: true, new_column: 'done' }, error: null });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(mockRequest({ action: 'approve' }), params);
    expect(res.status).toBe(200);
  });
});
