import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tasks/[id]/relations/route';
import { DELETE } from '@/app/api/tasks/[id]/relations/[relationId]/route';
import { authenticateRequest, extractInitData, getActiveWorkerInWorkspace, isWorkspaceMember } from '@core/api-auth';
import { createServerClient } from '@core/supabase';

vi.mock('@core/api-auth', () => ({ authenticateRequest: vi.fn(), extractInitData: vi.fn(), getActiveWorkerInWorkspace: vi.fn(), isWorkspaceMember: vi.fn() }));
vi.mock('@core/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@core/taskEnrichment', () => ({ enrichTaskRowsBatch: vi.fn((rows) => rows) }));

const task = { id: 'task-1', workspace_id: 'ws-1', title: 'Current', column: 'backlog', is_blocked: false, version: 1, updated_at: '2026-01-01T00:00:00Z' };
const related = { ...task, id: 'task-2', title: 'Related', is_blocked: true, version: 2 };
const params = { params: Promise.resolve({ id: 'task-1' }) };
const deleteParams = { params: Promise.resolve({ id: 'task-1', relationId: 'relation-1' }) };
const request = (body: Record<string, unknown> = {}) => ({ json: async () => body, headers: { get: () => 'init-data' } }) as unknown as NextRequest;

function makeSupabase(options: { related?: Record<string, unknown> | null; rpcResult?: { data?: unknown; error?: { message: string; code?: string } | null } } = {}) {
  let taskCalls = 0;
  const relations = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          or: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    })),
  };
  return {
    from: vi.fn((table: string) => ({ select: vi.fn(() => {
      if (table === 'task_relations') return relations.select();
      taskCalls += 1;
      if (taskCalls === 1) return { eq: vi.fn(() => ({ maybeSingle: async () => ({ data: task, error: null }) })) };
      if (taskCalls === 2) return { eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: options.related === undefined ? related : options.related, error: null }) })) })) };
      return { eq: vi.fn(() => ({ single: async () => ({ data: related, error: null }) })) };
    }) })),
    rpc: vi.fn(async () => options.rpcResult ?? { data: 'relation-1', error: null }),
    channel: vi.fn(() => ({ send: vi.fn(async () => undefined) })),
  } as unknown as ReturnType<typeof createServerClient>;
}

describe('/api/tasks/[id]/relations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: true, profileId: 'profile-1' });
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({ id: 'worker-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'human', role: 'member' });
  });

  it('GET returns 401 without authentication', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: false, error: 'missing_init_data', status: 401 });
    const response = await GET(request(), params);
    expect(response.status).toBe(401);
  });

  it('GET returns empty groups', async () => {
    vi.mocked(createServerClient).mockReturnValue(makeSupabase());
    const res = await GET(request(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ blockers: [], downstream: [] });
  });

  it('POST maps direction and server actor', async () => {
    const supabase = makeSupabase(); vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(request({ related_task_id: 'task-2', direction: 'blocked_by' }), params);
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('create_task_block_relation', { p_workspace_id: 'ws-1', p_from_task_id: 'task-2', p_to_task_id: 'task-1', p_created_by: 'worker-1' });
  });

  it('POST rejects non-member as 404', async () => {
    vi.mocked(isWorkspaceMember).mockResolvedValue(false); vi.mocked(createServerClient).mockReturnValue(makeSupabase());
    expect((await POST(request({ related_task_id: 'task-2', direction: 'blocks' }), params)).status).toBe(404);
  });

  it('POST maps duplicate and cycle to 409', async () => {
    for (const message of ['duplicate key', 'circular_dependency']) {
      const supabase = makeSupabase({ rpcResult: { error: { code: message === 'duplicate key' ? '23505' : 'P0001', message } } });
      vi.mocked(createServerClient).mockReturnValue(supabase);
      expect((await POST(request({ related_task_id: 'task-2', direction: 'blocks' }), params)).status).toBe(409);
    }
  });

  it('POST rejects done related task', async () => {
    vi.mocked(createServerClient).mockReturnValue(makeSupabase({ related: { ...related, column: 'done' } }));
    expect((await POST(request({ related_task_id: 'task-2', direction: 'blocks' }), params)).status).toBe(409);
  });

  it('DELETE uses atomic resource-scoped RPC', async () => {
    const supabase = makeSupabase({ rpcResult: { data: { relation_id: 'relation-1', affected_task: { id: 'task-1', is_blocked: false, version: 3, updated_at: related.updated_at } } } });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await DELETE(request(), deleteParams);
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('delete_task_block_relation', { p_workspace_id: 'ws-1', p_task_id: 'task-1', p_relation_id: 'relation-1' });
  });
});
