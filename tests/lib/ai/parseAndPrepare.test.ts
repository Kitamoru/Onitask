/**
 * Tests for parseAndPrepare (two-phase creation, ai_.md §3.6a).
 *
 * Covers:
 *   - CORE INVARIANT: draft phase performs ZERO DB writes
 *   - strategy (Gatekeeper) + showCorrectionSheet formula
 *   - error propagation from loadDraftContext
 *   - matchAssignee / finalizeTitles helpers
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/supabase';
import {
  prepareTaskDraft,
  matchAssignee,
  finalizeTitles,
  type DraftContext,
} from '../../../src/lib/ai/parseAndPrepare';
import type { ParseResponseV2 } from '../../../src/lib/ai/types';
import { DEFAULT_F04_CONFIG } from '../../../src/lib/ai/types';

// Mock LLM fallback chain (network) и cache-утилиты
vi.mock('../../../src/lib/ai/parseWithFallback', () => ({
  parseWithFallback: vi.fn(),
}));
vi.mock('../../../src/lib/ai/operationalContext', () => ({
  getOperationalContext: vi.fn(),
}));

import { parseWithFallback } from '../../../src/lib/ai/parseWithFallback';
import { getOperationalContext } from '../../../src/lib/ai/operationalContext';

export const VALID_PARSE: ParseResponseV2 = {
  title: 'Купить молоко',
  column: 'backlog',
  priority: 'medium',
  assignee: null,
  deadline: null,
  tags: ['дом'],
  confidence: 0.9,
  rewritten_title: 'Купить молоко в магазине',
  rewritten_description: 'Сходить в магазин за молоком',
  clarity_score: 0.9,
  complexity: 1,
};

/** Thenable chain-мок Supabase: loadDraftContext await-ит builder напрямую. */
export function makeDb(opts: {
  settings?: { data: unknown; error: unknown };
  workers?: { data: unknown; error: unknown };
} = {}) {
  const calls = { from: [] as string[], insert: [] as string[] };
  const db = {
    calls,
    from: vi.fn((table: string) => {
      calls.from.push(table);
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        insert: vi.fn(() => {
          calls.insert.push(table);
          return chain;
        }),
        maybeSingle: vi.fn(() =>
          Promise.resolve(opts.settings ?? { data: null, error: null }),
        ),
        then: (
          res: (v: { data: unknown; error: unknown }) => unknown,
        ) =>
          Promise.resolve(opts.workers ?? { data: [], error: null }).then(res),
      };
      return chain;
    }),
  };
  return db as unknown as SupabaseClient<Database> & { calls: typeof calls };
}
describe('prepareTaskDraft — two-phase draft (ai_.md §3.6a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOperationalContext).mockResolvedValue(null);
  });

  it('INVARIANT: draft-фаза НЕ пишет в БД (ни tasks, ни enrichment_queue, ни task_events)', async () => {
    vi.mocked(parseWithFallback).mockResolvedValue({
      parsed: VALID_PARSE,
      provider_used: 'neuraldeep',
      chain: [{ provider: 'neuraldeep', status: 'success' }],
      attempts_ms: 100,
    });
    const db = makeDb({
      settings: { data: null, error: null },
      workers: { data: [{ id: 'w1', display_name: 'Vadim' }], error: null },
    });

    const result = await prepareTaskDraft(db, 'ws-1', 'купить молоко');

    expect(result.ok).toBe(true);
    // читаются только settings и workers
    expect(db.calls.from.slice().sort()).toEqual(['workers', 'workspace_settings']);
    // и ни одной записи
    expect(db.calls.insert).toEqual([]);
  });

  it('strategy=skip при clarity>=0.85/complexity<=1, showCorrection=false', async () => {
    vi.mocked(parseWithFallback).mockResolvedValue({
      parsed: VALID_PARSE,
      provider_used: 'neuraldeep',
      chain: [],
      attempts_ms: 5,
    });
    const result = await prepareTaskDraft(makeDb(), 'ws-1', 'x');
    expect(result.ok && result.draft.strategy).toBe('skip');
    expect(result.ok && result.draft.showCorrectionSheet).toBe(false);
  });

  it('showCorrection=true при clarity ниже порога', async () => {
    vi.mocked(parseWithFallback).mockResolvedValue({
      parsed: { ...VALID_PARSE, clarity_score: 0.5 },
      provider_used: 'neuraldeep',
      chain: [],
      attempts_ms: 5,
    });
    const result = await prepareTaskDraft(makeDb(), 'ws-1', 'x');
    // complexity 1 → strategy light, clarity 0.5 < 0.70 → correction sheet
    expect(result.ok && result.draft.strategy).toBe('light');
    expect(result.ok && result.draft.showCorrectionSheet).toBe(true);
  });

  it('пробрасывает ошибку настроек как { ok:false, status:500 }', async () => {
    const db = makeDb({ settings: { data: null, error: { message: 'boom' } } });
    const result = await prepareTaskDraft(db, 'ws-1', 'x');
    expect(result).toEqual({ ok: false, error: 'Не удалось загрузить настройки', status: 500 });
  });

  it('пробрасывает ошибку workers как { ok:false, status:500 }', async () => {
    const db = makeDb({
      settings: { data: null, error: null },
      workers: { data: null, error: { message: 'boom' } },
    });
    const result = await prepareTaskDraft(db, 'ws-1', 'x');
    expect(result).toEqual({ ok: false, error: 'Не удалось загрузить команду', status: 500 });
  });
});

describe('matchAssignee / finalizeTitles', () => {
  const workers = [
    { id: 'w1', display_name: 'Vadim' },
    { id: 'w2', display_name: 'Anna' },
  ];

  it('матчит display_name без учёта регистра', () => {
    expect(matchAssignee(workers, { ...VALID_PARSE, assignee: 'vadim' })).toBe('w1');
  });

  it('возвращает null без совпадения и без assignee', () => {
    expect(matchAssignee(workers, { ...VALID_PARSE, assignee: 'Кто-то' })).toBeNull();
    expect(matchAssignee(workers, { ...VALID_PARSE, assignee: null })).toBeNull();
  });

  it('finalizeTitles: пустой rewritten_title → fallback на title', () => {
    const { finalTitle, finalDescription } = finalizeTitles({
      ...VALID_PARSE,
      rewritten_title: '  ',
      rewritten_description: '',
    });
    expect(finalTitle).toBe('Купить молоко');
    expect(finalDescription).toBe('');
  });

  it('finalizeTitles: непустой rewritten_title приоритетнее', () => {
    const { finalTitle } = finalizeTitles(VALID_PARSE);
    expect(finalTitle).toBe('Купить молоко в магазине');
  });
});