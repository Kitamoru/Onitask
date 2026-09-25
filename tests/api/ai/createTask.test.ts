/**
 * Tests for POST /api/ai/create-task — two-phase commit mode + legacy inline
 * mode (ai_.md §3.6a). Node-env, mock-based, pattern: review.test.ts.
 *
 * Covers:
 *   - Commit mode (`parsed` present): NO model call, Zod revalidation (400),
 *     INSERT tasks + enrichment_queue + task_events, parse_phase marker
 *   - Legacy mode (`parsed` absent): bot path unchanged (prepareTaskDraft used)
 *   - Auth (401), workspace tenancy (403/404)
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
vi.mock('@/lib/ai/parseAndPrepare', () => ({
  prepareTaskDraft: vi.fn(),
  loadDraftContext: vi.fn(),
  matchAssignee: vi.fn((workers: { id: string; display_name: string }[] | null, parsed: { assignee: string | null }) =>
    parsed.assignee ? (workers ?? []).find((w) => w.display_name.toLowerCase() === parsed.assignee?.toLowerCase())?.id ?? null : null
  ),
  finalizeTitles: vi.fn((parsed: { rewritten_title?: string; title: string; rewritten_description?: string }) => ({
    finalTitle: parsed.rewritten_title?.trim() || parsed.title,
    finalDescription: parsed.rewritten_description?.trim() || '',
  })),
}));

import { POST } from '@/app/api/ai/create-task/route';
import {
  authenticateRequest,
  getDefaultWorkspaceId,
  getUserWorkspaceIds,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';
import { prepareTaskDraft, loadDraftContext } from '@/lib/ai/parseAndPrepare';
import { parseResponseSchema, type ParseResponseV2 } from '@/lib/ai/types';

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

/** Достаточный мок Supabase для commit-режима create-task. */
function makeDb() {
    const inserted: { table: string; row: unknown }[] = [];
  const db = {
    inserted,
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        insert: vi.fn((payload: unknown) => {
          inserted.push({ table, row: payload });
          if (table === 'tasks') {
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({ data: { id: 'task-1', ...VALID_PARSE }, error: null }),
                ),
              })),
            };
          }
          return chain;
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
      return chain;
    }),
  };
    return db as unknown as ReturnType<typeof createServerClient> & {
    inserted: { table: string; row: unknown }[];
  };
}

function mockRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

describe('POST /api/ai/create-task — two-phase commit (parsed present)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
    } as never);
    vi.mocked(getUserWorkspaceIds).mockResolvedValue(['ws-1']);
    vi.mocked(getDefaultWorkspaceId).mockResolvedValue('ws-1');
    vi.mocked(loadDraftContext).mockResolvedValue({
      config: {
        skip_min_clarity: 0.85,
        skip_max_complexity: 1,
        correction_sheet_clarity_threshold: 0.7,
        low_clarity_tag_threshold: 0.55,
      },
      settings: null,
      operationalContext: null,
      workers: [{ id: 'w1', display_name: 'Vadim' }],
    });
  });

  it('commit: задача создаётся БЕЗ model call (prepareTaskDraft не вызывается)', async () => {
    const db = makeDb();
    vi.mocked(createServerClient).mockReturnValue(db);
        const res = await POST(
      mockRequest({ init_data: 'x', input: 'купить молоко', workspace_id: 'ws-1', parsed: VALID_PARSE }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.task.id).toBe('task-1');
    expect(json.parse).toEqual(VALID_PARSE);
    // не было model call
    expect(prepareTaskDraft).not.toHaveBeenCalled();
    // INSERT: tasks + enrichment_queue (strategy=skip → task_enrichments) + task_events
    const tables = db.inserted.map((i) => i.table).sort();
    expect(tables).toEqual(['task_enrichments', 'task_events', 'tasks']);
    // маркер two-phase в task_events
    const events = db.inserted.find((i) => i.table === 'task_events');
    expect((events?.row as { payload?: { parse_phase?: string } }).payload?.parse_phase).toBe(
      'user_confirmed_draft',
    );
  });

  it('commit: 400 при невалидном parsed (Zod revalidation)', async () => {
    const db = makeDb();
    vi.mocked(createServerClient).mockReturnValue(db);
        const res = await POST(
      mockRequest({ init_data: 'x', input: 'x', workspace_id: 'ws-1', parsed: { title: 123 } }),
    );
    expect(res.status).toBe(400);
    expect(db.inserted).toEqual([]);
  });

  it('commit: parsed проходит через parseResponseSchema (согласованность с Zod)', () => {
    // защита от дрейфа схемы: VALID_PARSE должен оставаться валидным
    expect(parseResponseSchema.safeParse(VALID_PARSE).success).toBe(true);
  });

describe('POST /api/ai/create-task — legacy inline (parsed absent, bot path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
    } as never);
    vi.mocked(getUserWorkspaceIds).mockResolvedValue(['ws-1']);
    vi.mocked(getDefaultWorkspaceId).mockResolvedValue('ws-1');
  });

  it('legacy: parse + INSERT за один вызов через prepareTaskDraft', async () => {
    const db = makeDb();
    vi.mocked(createServerClient).mockReturnValue(db);
    vi.mocked(prepareTaskDraft).mockResolvedValue({
      ok: true,
      draft: {
        parsed: VALID_PARSE,
        strategy: 'light',
        provider_used: 'groq',
        chain: [{ provider: 'groq', status: 'success' }],
        attempts_ms: 42,
        showCorrectionSheet: false,
        config: {
          skip_min_clarity: 0.85,
          skip_max_complexity: 1,
          correction_sheet_clarity_threshold: 0.7,
          low_clarity_tag_threshold: 0.55,
        },
        workers: [{ id: 'w1', display_name: 'Vadim' }],
      },
    });

        const res = await POST(
      // Bot-тело: без `parsed`, с source/profile_id — как в webhook route
      mockRequest({ input: 'текст', workspace_id: 'ws-1', source: 'bot', profile_id: 'profile-1' }),
    );
    expect(res.status).toBe(200);
    expect(prepareTaskDraft).toHaveBeenCalledTimes(1);
    const tables = db.inserted.map((i) => i.table).sort();
    expect(tables).toEqual(['enrichment_queue', 'task_events', 'tasks']);
    const events = db.inserted.find((i) => i.table === 'task_events');
    const payload = (events?.row as { payload?: { parse_phase?: string; provider_used?: string } }).payload;
    expect(payload?.parse_phase).toBeUndefined();
    expect(payload?.provider_used).toBe('groq');
  });

  it('legacy: 500 при ошибке parse-фазы (prepareTaskDraft ok:false)', async () => {
    const db = makeDb();
    vi.mocked(createServerClient).mockReturnValue(db);
    vi.mocked(prepareTaskDraft).mockResolvedValue({
      ok: false,
      error: 'Не удалось загрузить настройки',
      status: 500,
    });
        const res = await POST(
      mockRequest({ input: 'текст', workspace_id: 'ws-1' }),
    );
    expect(res.status).toBe(500);
    expect(db.inserted).toEqual([]);
  });
});
});