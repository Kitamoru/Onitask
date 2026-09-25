import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.hoisted(() => vi.fn());
const mockGetDefaultWorkspaceId = vi.hoisted(() => vi.fn());
const mockCreateServerClient = vi.hoisted(() => vi.fn());

vi.mock('@core/api-auth', () => ({
  authenticateRequest: mockAuthenticateRequest,
  getDefaultWorkspaceId: mockGetDefaultWorkspaceId,
}));
vi.mock('@core/supabase', () => ({ createServerClient: mockCreateServerClient }));

import { POST } from '@/app/api/flow/metrics/route';

function request(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

function emptyQuery() {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return query;
}

describe('POST /api/flow/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ authenticated: true, profileId: 'profile-1' });
    mockGetDefaultWorkspaceId.mockResolvedValue(null);
  });

  it('returns 401 without authentication', async () => {
    mockAuthenticateRequest.mockResolvedValue({ authenticated: false, error: 'invalid', status: 401 });
    const response = await POST(request({ init_data: 'x' }));
    expect(response.status).toBe(401);
  });

  it('returns a typed empty read model when the user has no workspace', async () => {
    mockCreateServerClient.mockReturnValue({ from: vi.fn(() => emptyQuery()) });
    const response = await POST(request({ init_data: 'x' }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.risk).toEqual({ people: 0, processes: 0, escalations: 0 });
    expect(json.data.riskBreakdown.processes).toEqual({ reviewBacklog: [], stuck: [], orphanBlockers: [] });
  });
});
