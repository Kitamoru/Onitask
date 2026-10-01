// SUB-01: сдача и ревью подзадачи НЕ должны фильтроваться по parent_task_id.
//
// Это тест на отсутствие гварда, а не на новую фичу. Подзадача — строка tasks,
// и весь контур (submit_task, review_action, merge_subtask_on_done из миг. 142)
// рассчитан именно на неё. Ловушка уже срабатывала один раз в этом же проекте:
// «подзадачи не самостоятельные задачи» превратилось в фильтр в
// enqueue_duplicate_check (миг. 139), и duplicate-check для подзадач просто
// перестал работать — тихо, без ошибки.
//
// Если кто-то добавит сюда `.is('parent_task_id', null)` «на всякий случай»,
// эти тесты упадут.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@core/api-auth', () => ({
  authenticateRequest: vi.fn(),
  extractInitData: vi.fn(),
  isWorkspaceMember: vi.fn(),
  getActiveWorkerInWorkspace: vi.fn(),
}));
vi.mock('@core/supabase', () => ({
  createServerClient: vi.fn(),
}));
vi.mock('@core/taskEnrichment', () => ({
  enrichTaskRow: vi.fn((row: unknown) => row),
}));

import { POST as reviewPOST } from '@/app/api/tasks/[id]/review/route';
import { POST as submitPOST } from '@/app/api/tasks/[id]/submit/route';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
  getActiveWorkerInWorkspace,
} from '@core/api-auth';
import { createServerClient } from '@core/supabase';

/** Строка подзадачи: те самые поля, которые роуты реально читают. */
const SUBTASK = {
  id: 'sub-1',
  workspace_id: 'ws-1',
  column: 'review',
  version: 3,
  created_by: 'author-1',
  assigned_to: 'worker-1',
  reviewer_id: 'reviewer-1',
  parent_task_id: 'parent-1',
  subtask_index: 1,
  metadata: {},
};

function mockRequest(body: Record<string, unknown> = {}) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

function buildSupabase(taskRow: unknown, rpcResult: unknown) {
  const maybeSingle = () => Promise.resolve({ data: taskRow, error: null });
  const single = () =>
    Promise.resolve({ data: { ...(taskRow as object), column: 'done' }, error: null });
  const eq = () => ({ maybeSingle, single });
  const select = () => ({ eq });
  return {
    from: () => ({ select }),
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
    channel: () => ({ send: vi.fn(() => Promise.resolve()) }),
  } as unknown as ReturnType<typeof createServerClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractInitData).mockResolvedValue('init-data');
  vi.mocked(authenticateRequest).mockResolvedValue({
    authenticated: true,
    profileId: 'profile-1',
    displayName: 'Tester',
  });
  vi.mocked(isWorkspaceMember).mockResolvedValue(true);
});

describe('сдача подзадачи', () => {
  const params = { params: Promise.resolve({ id: 'sub-1' }) };

  it('200: подзадача сдаётся так же, как задача, и RPC зовётся с её id', async () => {
    // Строка — подзадача (parent_task_id задан). Роут обязан её пропустить:
    // иначе «Написать текст» невозможно было бы отдать на ревью вообще.
    const supabase = buildSupabase(SUBTASK, {
      data: { submission_id: 'subm-1', reused: false },
      error: null,
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await submitPOST(
      mockRequest({
        target_column: 'review',
        body_text: 'Текст готов',
        links: [],
        attachment_ids: [],
      }),
      params,
    );

    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('submit_task', {
      p_task_id: 'sub-1',
      p_profile_id: 'profile-1',
      p_target_column: 'review',
      p_body_text: 'Текст готов',
      p_links: [],
      p_attachment_ids: [],
      p_expected_version: undefined,
      p_edited: true,
    });
  });
});

describe('ревью подзадачи', () => {
  const params = { params: Promise.resolve({ id: 'sub-1' }) };

  it('200: ревьюер согласует подзадачу через review_action', async () => {
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({
      id: 'reviewer-1',
      workspace_id: 'ws-1',
      source_id: 'profile-1',
      type: 'telegram',
      role: 'reviewer',
    } as never);
    const supabase = buildSupabase(SUBTASK, {
      data: { success: true, new_column: 'done' },
      error: null,
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await reviewPOST(mockRequest({ action: 'approve' }), params);

    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('review_action', {
      p_task_id: 'sub-1',
      p_action: 'approve',
      p_version: 3,
      p_actor_worker_id: 'reviewer-1',
      p_reason: undefined,
    });
  });

  it('200: возврат на доработку с причиной — и она ляжет в metadata', async () => {
    // Причина пишется в metadata.last_fix_reason (миг. 051) и показывается в
    // шторке подзадачи: комментарии у подзадачи не выводятся.
    vi.mocked(getActiveWorkerInWorkspace).mockResolvedValue({
      id: 'reviewer-1',
      workspace_id: 'ws-1',
      source_id: 'profile-1',
      type: 'telegram',
      role: 'reviewer',
    } as never);
    const supabase = buildSupabase(SUBTASK, {
      data: { success: true, new_column: 'in_progress' },
      error: null,
    });
    vi.mocked(createServerClient).mockReturnValue(supabase);

    const res = await reviewPOST(
      mockRequest({ action: 'fix', reason: 'Перепишите раздел' }),
      params,
    );

    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('review_action', {
      p_task_id: 'sub-1',
      p_action: 'fix',
      p_version: 3,
      p_actor_worker_id: 'reviewer-1',
      p_reason: 'Перепишите раздел',
    });
  });
});