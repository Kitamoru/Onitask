import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/tasks/escalations/route';
import { POST } from '@/app/api/tasks/[id]/escalations/retry/route';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
  isWorkspaceMember,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  extractInitData: vi.fn(),
  getActiveWorkerInWorkspace: vi.fn(),
  isWorkspaceMember: vi.fn(),
}));
vi.mock('@core/supabase', () => ({ createServerClient: vi.fn() }));

const task = { workspace_id: 'ws-1' };
const params = { params: Promise.resolve({ id: 'task-1' }) };
const request = () => ({ headers: { get: () => 'init-data' } }) as unknown as NextRequest;
const getRequest = (workspaceId: string) => ({
  headers: { get: () => 'init-data' },
  nextUrl: { searchParams: new Map([['workspace_id', workspaceId]]) },
}) as unknown as NextRequest;
const getAllRequest = () => ({
  headers: { get: () => 'init-data' },
  nextUrl: { searchParams: new Map([['scope', 'all']]) },
}) as unknown as NextRequest;

function successResult() {
  return {
    success: true,
    task_id: 'task-1',
    needs_human: false,
    escalation_reason: null,
    is_blocked: false,
    version: 3,
    updated_at: '2026-01-01T00:00:00Z',
    retry_started: true,
    dispatch_created: true,
    already_resolved: false,
  };
}

function makeGetSupabase(options: {
  queue?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
} = {}) {
  const queue = options.queue ?? [];
  const taskRows = options.tasks ?? [];
  let workerQueryCount = 0;
  return {
    from: vi.fn((table: string) => {
      if (table === 'pending_escalations') {
        const chain: Record<string, unknown> = {
          in: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: queue, error: null })),
        };
        return { select: vi.fn(() => chain) };
      }
      if (table === 'workspaces') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: [{ id: 'ws-1', name: 'Alpha', task_prefix: 'ALPHA' }], error: null })),
            eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: 'ws-1', name: 'Alpha', task_prefix: 'ALPHA' }, error: null })) })),
          })),
        };
      }
      if (table === 'tasks') {
        const chain: Record<string, unknown> = {
          in: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: taskRows, error: null })),
        };
        return { select: vi.fn(() => chain) };
      }
      if (table === 'workers') {
        workerQueryCount += 1;
        if (workerQueryCount === 1) {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ data: [{ workspace_id: 'ws-1' }], error: null })) })) })) };
        }
        const chain: Record<string, unknown> = {
          in: vi.fn(() => chain),
          like: vi.fn(() => Promise.resolve({ data: [{ id: 'agent-1' }], error: null })),
          eq: vi.fn(() => chain),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [{ id: 'agent-1' }], error: null })),
        };
        return { select: vi.fn(() => chain) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as ReturnType<typeof createServerClient>;
}

function makeRetrySupabase(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: task, error: null })) })),
      })),
    })),
    rpc: vi.fn(async () => result),
    channel: vi.fn(() => ({ send: vi.fn(async () => undefined) })),
  } as unknown as ReturnType<typeof createServerClient>;
}

describe('/api/tasks/escalations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractInitData).mockResolvedValue('init-data');
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: true, profileId: 'profile-1' });
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({
      id: 'worker-1', workspace_id: 'ws-1', source_id: 'profile-1', type: 'human', role: 'member',
    });
    vi.mocked(isWorkspaceMember).mockResolvedValue(true);
  });

  it('GET returns 401 without authentication', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: false, error: 'missing_init_data', status: 401 });
    expect((await GET(getRequest('ws-1'))).status).toBe(401);
  });

  it('GET maps visible reason, agent and retry eligibility', async () => {
    const supabase = makeGetSupabase({
      queue: [{
        id: 'task-1', title: 'Prepare note', escalation_reason: 'max_attempts',
        workspace_id: 'ws-1', assigned_agent: 'Drift',
        moved_to_column_at: '2026-01-01T00:00:00Z', hours_pending: 2,
      }],
      tasks: [{
        id: 'task-1', workspace_id: 'ws-1', task_number: 42, column: 'in_progress', is_blocked: false,
        active_claim_id: null, assigned_to: 'agent-1',
        metadata: { nack_reason: 'bad_response', nack_detail: 'invalid JSON' },
      }],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await GET(getRequest('ws-1'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [expect.objectContaining({
      full_id: 'ALPHA-42', reason_label: 'Не удалось выполнить задачу после трёх попыток',
      agent_name: 'Drift',
    })] });
  });

  it('GET returns 404 for a workspace the user is not a member of', async () => {
    vi.mocked(isWorkspaceMember).mockResolvedValue(false);
    const supabase = makeGetSupabase();
    vi.mocked(createServerClient).mockReturnValue(supabase);
    expect((await GET(getRequest('foreign-ws'))).status).toBe(404);
  });
  it('GET includes all member workspaces with scope=all', async () => {
    const supabase = makeGetSupabase({
      queue: [{
        id: 'task-1', title: 'Prepare note', escalation_reason: 'max_attempts',
        workspace_id: 'ws-1', assigned_agent: 'Drift',
        moved_to_column_at: '2026-01-01T00:00:00Z', hours_pending: 2,
      }],
      tasks: [{
        id: 'task-1', workspace_id: 'ws-1', task_number: 42, column: 'in_progress', is_blocked: false,
        active_claim_id: null, assigned_to: 'agent-1', metadata: {},
      }],
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await GET(getAllRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [expect.objectContaining({ workspace_id: 'ws-1' })] });
  });



  it('POST returns 401 without authentication', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ authenticated: false, error: 'missing_init_data', status: 401 });
    expect((await POST(request(), params)).status).toBe(401);
  });

  it('POST maps server actor and atomic RPC arguments', async () => {
    const supabase = makeRetrySupabase({ data: successResult(), error: null });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(request(), params);
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('operator_retry_escalation', {
      p_workspace_id: 'ws-1', p_task_id: 'task-1', p_actor_worker_id: 'worker-1',
    });
    expect(await res.json()).toEqual(successResult());
  });

  it('POST maps domain errors to user-facing 409', async () => {
    vi.mocked(createServerClient).mockReturnValue(makeRetrySupabase({
      data: { success: false, error: { code: 'task_blocked', message: 'blocked' } }, error: null,
    }));
    const res = await POST(request(), params);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'Сначала снимите блокировку задачи' });
  });

  it('POST is idempotent after a successful retry', async () => {
    vi.mocked(createServerClient).mockReturnValue(makeRetrySupabase({
      data: { ...successResult(), retry_started: false, dispatch_created: false, already_resolved: true },
      error: null,
    }));
    const res = await POST(request(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ already_resolved: true }));
  });
});
