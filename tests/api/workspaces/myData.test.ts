import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.hoisted(() => vi.fn());
const mockCreateServerClient = vi.hoisted(() => vi.fn());

vi.mock('@core/api-auth', () => ({ authenticateRequest: mockAuthenticateRequest }));
vi.mock('@core/supabase', () => ({ createServerClient: mockCreateServerClient }));
vi.mock('@core/taskEnrichment', () => ({
  enrichTaskRowsBatch: vi.fn(async (rows: unknown[]) => rows),
}));
vi.mock('@/lib/sprintSummary', () => ({
  buildSprintsByWorkspace: vi.fn(() => ({})),
}));

import { POST } from '@/app/api/workspaces/my-data/route';

function request(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

describe('POST /api/workspaces/my-data tenancy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
    });
  });

  it('returns 401 without authentication', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: false,
      error: 'invalid_init_data',
      status: 401,
    });
    const response = await POST(request({ init_data: 'x', workspace_id: 'ws-1' }));
    expect(response.status).toBe(401);
  });

  it('rejects a requested workspace before scoped data queries', async () => {
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.then = (
      resolve: (value: { data: unknown; error: null }) => unknown,
    ) => Promise.resolve({ data: [{ workspace_id: 'ws-member' }], error: null }).then(resolve);
    const supabase = {
      from: vi.fn(() => query),
    };
    mockCreateServerClient.mockReturnValue(supabase);

    const response = await POST(request({
      init_data: 'x',
      workspace_id: 'ws-foreign',
      partial: true,
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'workspace_not_found' });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
