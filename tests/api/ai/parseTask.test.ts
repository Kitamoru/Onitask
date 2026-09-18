/**
 * Tests for POST /api/ai/parse-task — draft phase of two-phase creation
 * (ai_.md §3.6a). Node-env, mock-based, pattern: tests/api/tasks/review.test.ts.
 *
 * Covers:
 *   - auth (401), input validation (400), workspace tenancy (403/404)
 *   - happy path: { parse, strategy, showCorrectionSheet }
 *   - 400 when parse yields empty title
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
  getUserWorkspaceIds: vi.fn(),
}));
vi.mock('@core/supabase', () => ({
  createServerClient: vi.fn(),
}));

import { POST } from '@/app/api/ai/parse-task/route';
import {
  authenticateRequest,
  getDefaultWorkspaceId,
  getUserWorkspaceIds,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';
import { prepareTaskDraft } from '@/lib/ai/parseAndPrepare';
import type { ParseResponseV2 } from '@/lib/ai/types';

vi.mock('@/lib/ai/parseAndPrepare', () => ({
  prepareTaskDraft: vi.fn(),
}));

const VALID_PARSE: ParseResponseV2 = {
  title: 'Купить молоко',
  column: 'backlog',
  priority: 'medium',
  assignee: null,
  deadline: null,
  tags: [],
  confidence: 0.9,
  rewritten_title: 'Купить молоко в магазине',
  rewritten_description: 'Сходить в магазин',
  clarity_score: 0.9,
  complexity: 1,
};

function mockRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('POST /api/ai/parse-task — draft phase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
    } as never);
    vi.mocked(getUserWorkspaceIds).mockResolvedValue(['ws-1']);
    vi.mocked(getDefaultWorkspaceId).mockResolvedValue('ws-1');
    vi.mocked(prepareTaskDraft).mockResolvedValue({
      ok: true,
      draft: {
        parsed: VALID_PARSE,
        strategy: 'skip',
        provider_used: 'neuraldeep',
        chain: [],
        attempts_ms: 10,
        showCorrectionSheet: false,
        config: {} as never,
        workers: [],
      },
    });
  });

  it('401 без валидного initData', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: false,
      error: 'bad',
      status: 401,
    } as never);
    const res = await POST(mockRequest({ init_data: 'x', input: 'задача' }));
    expect(res.status).toBe(401);
  });

  it('400 без input', async () => {
    const res = await POST(mockRequest({ init_data: 'x' }));
    expect(res.status).toBe(400);
  });

  it('403 при чужом workspace_id (не член)', async () => {
    const res = await POST(
      mockRequest({ init_data: 'x', input: 'задача', workspace_id: 'ws-other' }),
    );
    expect(res.status).toBe(403);
  });

  it('404 когда workspace не резолвится', async () => {
    vi.mocked(getUserWorkspaceIds).mockResolvedValue([]);
    vi.mocked(getDefaultWorkspaceId).mockResolvedValue(null);
    const res = await POST(mockRequest({ init_data: 'x', input: 'задача' }));
    expect(res.status).toBe(404);
  });

  it('happy path: { parse, strategy, showCorrectionSheet }', async () => {
    const res = await POST(
      mockRequest({ init_data: 'x', input: 'купить молоко', workspace_id: 'ws-1' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.parse).toEqual(VALID_PARSE);
    expect(json.strategy).toBe('skip');
    expect(json.showCorrectionSheet).toBe(false);
  });

  it('400 при пустом заголовке после parse', async () => {
    vi.mocked(prepareTaskDraft).mockResolvedValue({
      ok: true,
      draft: {
        parsed: { ...VALID_PARSE, title: '', rewritten_title: '' },
        strategy: 'skip',
        provider_used: 'deterministic-fallback',
        chain: [],
        attempts_ms: 0,
        showCorrectionSheet: true,
        config: {} as never,
        workers: [],
      },
    });
    const res = await POST(mockRequest({ init_data: 'x', input: 'x' }));
    expect(res.status).toBe(400);
  });

  it('пробрасывает 500 из prepareTaskDraft', async () => {
    vi.mocked(prepareTaskDraft).mockResolvedValue({
      ok: false,
      error: 'Не удалось загрузить настройки',
      status: 500,
    });
    const res = await POST(mockRequest({ init_data: 'x', input: 'x' }));
    expect(res.status).toBe(500);
  });
});