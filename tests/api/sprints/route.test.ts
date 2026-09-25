import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.hoisted(() => vi.fn());
const mockExtractInitData = vi.hoisted(() => vi.fn());
const mockGetUserWorkspaceIds = vi.hoisted(() => vi.fn());
const mockIsWorkspaceMember = vi.hoisted(() => vi.fn());
const mockCreateServerClient = vi.hoisted(() => vi.fn());

vi.mock('@core/api-auth', () => ({
  authenticateRequest: mockAuthenticateRequest,
  extractInitData: mockExtractInitData,
  getUserWorkspaceIds: mockGetUserWorkspaceIds,
  isWorkspaceMember: mockIsWorkspaceMember,
}));
vi.mock('@core/supabase', () => ({ createServerClient: mockCreateServerClient }));

import { POST } from '@/app/api/sprints/route';

function request(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

function buildSupabase() {
  const updateBuilder: Record<string, unknown> = {};
  updateBuilder.in = vi.fn(() => updateBuilder);
  updateBuilder.eq = vi.fn(() => Promise.resolve({ error: null }));

  const insertBuilder: Record<string, unknown> = {};
  insertBuilder.select = vi.fn(() => insertBuilder);
  insertBuilder.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: 'sprint-1' }, error: null }));

  const sprintTable = { insert: vi.fn(() => insertBuilder) };
  const taskTable = { update: vi.fn(() => updateBuilder) };
  return { from: vi.fn((table: string) => (table === 'sprints' ? sprintTable : taskTable)), sprintTable, taskTable };
}

describe('POST /api/sprints — task assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractInitData.mockResolvedValue('init-data');
    mockAuthenticateRequest.mockResolvedValue({ authenticated: true, profileId: 'profile-1' });
    mockGetUserWorkspaceIds.mockResolvedValue(['ws-1']);
    mockIsWorkspaceMember.mockResolvedValue(true);
  });

  it('accepts camelCase taskIds and persists sprint_id on selected tasks', async () => {
    const supabase = buildSupabase();
    mockCreateServerClient.mockReturnValue(supabase);

    const response = await POST(request({
      init_data: 'init-data', workspace_id: 'ws-1', name: 'Sprint 1',
      startDate: '2026-09-25', endDate: '2026-10-02', taskIds: ['task-1', 'task-2'],
    }));

    expect(response.status).toBe(201);
    const updateBuilder = supabase.taskTable.update.mock.results[0].value;
    expect(supabase.taskTable.update).toHaveBeenCalledWith({ sprint_id: 'sprint-1' });
    expect(updateBuilder.in).toHaveBeenCalledWith('id', ['task-1', 'task-2']);
    expect(updateBuilder.in().eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });
});
