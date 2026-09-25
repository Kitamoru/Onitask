// Tests for POST /api/init — Auth flow validation
// AUTH-03: 401-обработка + интеграционный тест (mock-based)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockValidateTelegramInitData = vi.hoisted(() => vi.fn());
const mockCreateServerClient = vi.hoisted(() => vi.fn());
const mockResolveTaskLaunchTarget = vi.hoisted(() => vi.fn());
const mockResolveFlowLaunchTarget = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

import { POST } from '../../src/app/api/init/route';
import type { NextRequest } from 'next/server';

// Mock modules

vi.mock('../../src/lib/telegram/validate', () => ({
  validateTelegramInitData: (...args: any[]) => mockValidateTelegramInitData(...args),
}));

vi.mock('../../lib/supabase', () => ({
  createServerClient: (...args: any[]) => mockCreateServerClient(...args),
}));

vi.mock('../../src/lib/server/taskLaunch', () => ({
  resolveTaskLaunchTarget: (...args: any[]) => mockResolveTaskLaunchTarget(...args),
  resolveFlowLaunchTarget: (...args: any[]) => mockResolveFlowLaunchTarget(...args),
}));

// Helper to create a mock NextRequest
function createMockRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as NextRequest;
}

function createThenable<T>(value: T) {
  const chain: Record<string, any> = {};
  for (const method of ['eq', 'select', 'upsert', 'insert', 'in']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: value, error: null }));
  chain.single = vi.fn(async () => ({ data: value, error: null }));
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason?: unknown) => unknown) =>
    Promise.resolve({ data: value, error: null }).then(resolve, reject);
  return chain;
}

describe('POST /api/init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockResolveTaskLaunchTarget.mockResolvedValue(null);
    mockResolveFlowLaunchTarget.mockResolvedValue(null);
  });

  // Тест 1: Missing init_data → 400
  it('returns 400 when init_data is missing', async () => {
    const request = createMockRequest({});
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('missing_init_data');
  });

  // Тест 2: Invalid initData (bad hash) → 401
  it('returns 401 when hash is invalid', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: false,
      error: 'invalid_hash',
    });

    const request = createMockRequest({ init_data: 'user=eyJpZCI6IjEyMyJ9&hash=abc123' });
    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('invalid_hash');
  });

  // Тест 3: Expired initData (>24h) → 401
  it('returns 401 when auth_date is expired', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: false,
      error: 'expired_init_data',
    });

    const oldTimestamp = Math.floor(Date.now() / 1000) - 100000; // > 24 hours ago
    const request = createMockRequest({
      init_data: `user=eyJpZCI6IjEyMyJ9&auth_date=${oldTimestamp}&hash=abc`,
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('expired_init_data');
  });

  // Тест 4: Valid initData, new user → 200 + is_new_user=true
  it('returns 200 with is_new_user=true for new user', async () => {
    // Mock successful Telegram validation
    mockValidateTelegramInitData.mockResolvedValue({
      valid: true,
      user: {
        id: '987654321',
        is_bot: false,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'en',
      },
    });

    const profileQuery = createThenable(null);
    profileQuery.insert = vi.fn(() => createThenable({
      id: 'new-user-uuid-here',
      telegram_id: 987654321,
      display_name: 'testuser',
      avatar_url: null,
    }));
    const mockSupabase = {
      from: vi.fn(() => profileQuery),
    };
    mockCreateServerClient.mockReturnValue(mockSupabase);

    const request = createMockRequest({
      init_data: 'user=eyJpZCI6Ijk4NzY1NDMyMSIsImZpcnN0X25hbWUiOiJUZXN0IiwibGFzdF9uYW1lIjoiVXNlciIsInVzZXJuYW1lIjoidGVzdHVzZXIiLCJsYW5ndWFnZV9jb2RlIjoiZW4ifQ&auth_date=1700000000&hash=valid_hash',
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.is_new_user).toBe(true);
    expect(data.data.worker.display_name).toBe('testuser');
  });

  it('task deep link returns launch context without invite redemption', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: true,
      user: { id: '987654321', is_bot: false, first_name: 'Test', username: 'testuser' },
    });
    const profileQuery = createThenable({
      id: 'profile-uuid', telegram_id: 987654321, display_name: 'testuser',
      avatar_url: null, last_active_workspace_id: 'ws-a',
    });
    const workersQuery = createThenable([
      { id: 'worker-a', workspace_id: 'ws-a', role: 'member' },
    ]);
    const workspacesQuery = createThenable([
      { id: 'ws-a', name: 'Alpha', slug: 'alpha', task_prefix: 'ALPHA' },
    ]);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') return profileQuery;
        if (table === 'workers') return workersQuery;
        if (table === 'workspaces') return workspacesQuery;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc: vi.fn(async () => ({ data: null, error: { message: 'unexpected invite redemption' } })),
    };
    mockCreateServerClient.mockReturnValue(supabase);
    mockResolveTaskLaunchTarget.mockResolvedValue({
      kind: 'task', taskId: 'task-b', workspaceId: 'ws-b', workspaceSlug: 'beta',
      fullId: 'BETA-42', tab: 'comments',
    });
    const response = await POST(createMockRequest({ init_data: 'valid', start_param: 'task_BETA-42_comments' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      data: expect.objectContaining({
        launch_context: expect.objectContaining({ task_id: 'task-b', workspace_id: 'ws-b', tab: 'comments' }),
      }),
    }));
    expect(supabase.rpc).not.toHaveBeenCalled();
  });


  it('existing user invite selects redeemed workspace for this launch', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: true,
      user: { id: '987654321', is_bot: false, first_name: 'Test', username: 'testuser' },
    });
    const profileQuery = createThenable({
      id: 'profile-uuid', telegram_id: 987654321, display_name: 'testuser',
      avatar_url: null, last_active_workspace_id: 'ws-a',
    });
    const workersQuery = createThenable([
      { id: 'worker-a', workspace_id: 'ws-a', role: 'member' },
      { id: 'worker-b', workspace_id: 'ws-b', role: 'member' },
    ]);
    const workspacesQuery = createThenable([
      { id: 'ws-a', name: 'Alpha', slug: 'alpha', task_prefix: 'ALPHA' },
      { id: 'ws-b', name: 'Beta', slug: 'beta', task_prefix: 'BETA' },
    ]);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') return profileQuery;
        if (table === 'workers') return workersQuery;
        if (table === 'workspaces') return workspacesQuery;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc: vi.fn(async () => ({ data: [{ workspace_id: 'ws-b' }], error: null })),
    };
    mockCreateServerClient.mockReturnValue(supabase);

    const response = await POST(createMockRequest({ init_data: 'valid', start_param: 'invite_CODE' }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.last_active_workspace_id).toBe('ws-b');
    expect(payload.data.worker.workspace_id).toBe('ws-b');
    expect(supabase.rpc).toHaveBeenCalledWith('accept_invite_link', expect.objectContaining({
      p_code: 'CODE', p_source_id: 'profile-uuid',
    }));
  });

  it('returns 500 when invite acceptance RPC fails', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: true,
      user: {
        id: '987654321',
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
        language_code: 'en',
      },
    });

    const profileQuery = createThenable({
      id: 'profile-uuid',
      telegram_id: 987654321,
      display_name: 'testuser',
      avatar_url: null,
      last_active_workspace_id: null,
    });
    const mockSupabase = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'invite redemption failed' },
      })),
      from: vi.fn(() => profileQuery),
    };
    mockCreateServerClient.mockReturnValue(mockSupabase);

    const request = createMockRequest({
      initData: 'valid',
      start_param: 'invite-code',
    });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('invite_acceptance_failed');
  });
});