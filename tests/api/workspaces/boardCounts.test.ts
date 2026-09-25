// Tests for POST /api/workspaces/board-counts — BOARD-AGG (node-env, mock-based).
// Паттерн: как tests/api/tasks/review.test.ts — vi.mock('@core/*'),
// фейковый supabase-чейн, агрегация считается роутом из сырых строк.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));
vi.mock('@core/supabase', () => ({
  createServerClient: vi.fn(),
}));

import { POST } from '@/app/api/workspaces/board-counts/route';
import { authenticateRequest } from '@core/api-auth';
import { createServerClient } from '@core/supabase';

type QResult = { data: unknown; error: unknown };

function mockRequest(body: Record<string, unknown> = {}) {
  return { json: async () => body } as unknown as NextRequest;
}

/** Thenable-чейн supabase-query builder'а, резолвится в result. */
function chain(result: QResult) {
  const c: Record<string, unknown> = {
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    order: vi.fn(() => c),
    then: (onF: (v: QResult) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR),
    catch: (onR: (e: unknown) => unknown) => Promise.resolve(result).catch(onR),
  };
  return c;
}

/**
 * Фейковый supabase: from('table').select(cols) → чейн, резолвящийся
 * по колонкам select'а (роут делает 4 разных запроса к 3 таблицам).
 */
function buildSupabase(bySelect: Record<string, QResult>) {
  return {
    from: vi.fn(() => ({
      select: vi.fn((cols: string) => chain(bySelect[cols] ?? { data: [], error: null })),
    })),
  } as unknown as ReturnType<typeof createServerClient>;
}

const SELECT_USER_WORKERS = 'workspace_id';
const SELECT_MEMBERS = 'id, workspace_id, type';
const SELECT_TASKS = 'workspace_id, column, assigned_to, reviewer_id, cognitive_weight, is_inbox';
const SELECT_SPRINTS = 'workspace_id, name, goal, status, start_date, end_date';
const SELECT_SETTINGS = 'workspace_id, enable_cognitive_budget';
const SELECT_REVIEW = 'workspace_id, reviewer_id, review_count';
const SELECT_STUCK = 'workspace_id, id, title, assigned_to';
const SELECT_ORPHAN = 'workspace_id, id, title, hours_blocked';
const SELECT_ESCALATIONS = 'workspace_id, id, title, escalation_reason';

describe('POST /api/workspaces/board-counts — BOARD-AGG (route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      profileId: 'profile-1',
      displayName: 'Tester',
    } as never);
  });

  it('401 при неаутентифицированном запросе', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: false,
      error: 'bad_hash',
      status: 401,
    } as never);
    const res = await POST(mockRequest({ init_data: 'x' }));
    expect(res.status).toBe(401);
  });

  it('500 database_error при ошибке запроса воркеров', async () => {
    vi.mocked(createServerClient).mockReturnValue(
      buildSupabase({ [SELECT_USER_WORKERS]: { data: null, error: { message: 'db down' } } }),
    );
    const res = await POST(mockRequest({ init_data: 'x' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('database_error');
  });

  it('нет workspace → нули и пустые карты (без запроса задач)', async () => {
    const supabase = buildSupabase({
      [SELECT_USER_WORKERS]: { data: [], error: null },
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);
    const res = await POST(mockRequest({ init_data: 'x' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      counts: {},
      members: {},
      riskData: { people: 0, processes: 0, escalations: 0 },
      sprintsByWorkspace: {},
    });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('агрегация: counts по колонкам, riskData, members по двум workspace', async () => {
    const supabase = buildSupabase({
      [SELECT_USER_WORKERS]: {
        data: [{ workspace_id: 'ws-1' }, { workspace_id: 'ws-2' }],
        error: null,
      },
      [SELECT_TASKS]: {
        data: [
          // ws-1: 2 backlog, 1 in_progress (p1), 1 review, 3 done
          { workspace_id: 'ws-1', column: 'backlog', assigned_to: null, needs_human: false, is_inbox: false },
          { workspace_id: 'ws-1', column: 'backlog', assigned_to: null, needs_human: false, is_inbox: false },
          { workspace_id: 'ws-1', column: 'in_progress', assigned_to: 'p1', needs_human: true, is_inbox: false },
          { workspace_id: 'ws-1', column: 'review', assigned_to: 'p1', needs_human: false, is_inbox: false },
          { workspace_id: 'ws-1', column: 'done', assigned_to: 'p2', needs_human: false, is_inbox: false },
          { workspace_id: 'ws-1', column: 'done', assigned_to: null, needs_human: false, is_inbox: false },
          { workspace_id: 'ws-1', column: 'done', assigned_to: null, needs_human: false, is_inbox: false },
          // ws-2: 1 in_progress (p2 — тот же человек), 1 done
          { workspace_id: 'ws-2', column: 'in_progress', assigned_to: 'p2', needs_human: false, is_inbox: false },
          { workspace_id: 'ws-2', column: 'done', assigned_to: null, needs_human: false, is_inbox: false },
          // неканоническая колонка → в counts не попадает
          { workspace_id: 'ws-2', column: 'inbox', assigned_to: 'p3', needs_human: false, is_inbox: false },
        ],
        error: null,
      },
      [SELECT_MEMBERS]: {
        data: [
          { id: 'h1', workspace_id: 'ws-1', type: 'human' },
          { id: 'h2', workspace_id: 'ws-1', type: 'human' },
          { id: 'a1', workspace_id: 'ws-1', type: 'agent' },
          { id: 'h3', workspace_id: 'ws-2', type: 'human' },
        ],
        error: null,
      },
      [SELECT_SPRINTS]: { data: [], error: null },
      [SELECT_SETTINGS]: { data: [{ workspace_id: 'ws-1', enable_cognitive_budget: true }, { workspace_id: 'ws-2', enable_cognitive_budget: true }], error: null },
      [SELECT_REVIEW]: { data: [{ workspace_id: 'ws-1', reviewer_id: 'h1' }], error: null },
      [SELECT_STUCK]: { data: [{ workspace_id: 'ws-1', id: 's1' }], error: null },
      [SELECT_ORPHAN]: { data: [{ workspace_id: 'ws-2', id: 'o1' }], error: null },
      [SELECT_ESCALATIONS]: { data: [{ workspace_id: 'ws-1', id: 'e1' }], error: null },
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(mockRequest({ init_data: 'x' }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.data.counts).toEqual({
      'ws-1': { inQueue: 2, inWork: 1, onReview: 1, done: 3 },
      'ws-2': { inQueue: 0, inWork: 1, onReview: 0, done: 1 },
    });
    // People: F-01 overloaded humans. Processes: review backlog + stuck + orphan.
    expect(json.data.riskData).toEqual({ people: 0, processes: 3, escalations: 1 });
    expect(json.data.members).toEqual({
      'ws-1': { humans: 2, agents: 1 },
      'ws-2': { humans: 1, agents: 0 },
    });
    expect(json.data.sprintsByWorkspace).toEqual({});
  });

  it('чужой workspace в строке задач (не из списка) игнорируется', async () => {
    const supabase = buildSupabase({
      [SELECT_USER_WORKERS]: { data: [{ workspace_id: 'ws-1' }], error: null },
      [SELECT_TASKS]: {
        data: [
          { workspace_id: 'ws-1', column: 'done', assigned_to: null, needs_human: false, is_inbox: false },
          { workspace_id: 'ws-other', column: 'done', assigned_to: null, needs_human: false, is_inbox: false },
        ],
        error: null,
      },
      [SELECT_MEMBERS]: { data: [], error: null },
      [SELECT_SPRINTS]: { data: [], error: null },
      [SELECT_SETTINGS]: { data: [], error: null },
      [SELECT_REVIEW]: { data: [], error: null },
      [SELECT_STUCK]: { data: [], error: null },
      [SELECT_ORPHAN]: { data: [], error: null },
      [SELECT_ESCALATIONS]: { data: [], error: null },
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(mockRequest({ init_data: 'x' }));
    const json = await res.json();
    expect(json.data.counts['ws-1']).toEqual({ inQueue: 0, inWork: 0, onReview: 0, done: 1 });
    expect(json.data.counts['ws-other']).toBeUndefined();
  });

  it('спринты проксируются в sprintsByWorkspace', async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const supabase = buildSupabase({
      [SELECT_USER_WORKERS]: { data: [{ workspace_id: 'ws-1' }], error: null },
      [SELECT_TASKS]: { data: [], error: null },
      [SELECT_MEMBERS]: { data: [], error: null },
      [SELECT_SPRINTS]: {
        data: [
          {
            workspace_id: 'ws-1',
            name: 'S1',
            goal: 'Goal',
            status: 'active',
            start_date: start.toISOString().slice(0, 10),
            end_date: end.toISOString().slice(0, 10),
          },
        ],
        error: null,
      },
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await POST(mockRequest({ init_data: 'x' }));
    const json = await res.json();
    expect(json.data.sprintsByWorkspace['ws-1']).toMatchObject({
      name: 'S1',
      topic: 'Goal',
      isActive: true,
      totalDays: 7,
    });
  });
});
