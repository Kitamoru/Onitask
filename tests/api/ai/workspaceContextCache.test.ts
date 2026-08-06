/**
 * Tests for workspaceContextCache utility (F-04-11).
 *
 * Covers:
 *   - Successful read of workspace_context_cache + context_stale
 *   - Returns null when workspace_settings row not found
 *   - Returns null on DB error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getWorkspaceContextCache, type WorkspaceContextCacheResult } from '../../../src/lib/ai/workspaceContextCache';

// Mock Supabase client — путь к реальному модулю lib/supabase.ts
vi.mock('../../../lib/supabase', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '../../../lib/supabase';

const mockCreateClient = vi.mocked(createServerClient);

describe('getWorkspaceContextCache', () => {
  const WORKSPACE_ID = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cache data when query succeeds', async () => {
    const expected: WorkspaceContextCacheResult = {
      workspace_context_cache: '{"sprint": "S1|active", "blockers": 2}',
      context_stale: false,
    };

    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: expected, error: null }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const result = await getWorkspaceContextCache(WORKSPACE_ID);

    expect(result).toEqual(expected);
    expect(mockSupabase.from).toHaveBeenCalledWith('workspace_settings');
    expect(mockSupabase.eq).toHaveBeenCalledWith('workspace_id', WORKSPACE_ID);
  });

  it('returns null when DB returns an error', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "workspace_settings" does not exist' },
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const result = await getWorkspaceContextCache(WORKSPACE_ID);

    expect(result).toBeNull();
  });

  it('returns null when no row is found (data is null)', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const result = await getWorkspaceContextCache(WORKSPACE_ID);

    expect(result).toBeNull();
  });

  it('handles null workspace_context_cache gracefully', async () => {
    const expected: WorkspaceContextCacheResult = {
      workspace_context_cache: null,
      context_stale: false,
    };

    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: expected, error: null }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const result = await getWorkspaceContextCache(WORKSPACE_ID);

    expect(result?.workspace_context_cache).toBeNull();
    expect(result?.context_stale).toBe(false);
  });
});