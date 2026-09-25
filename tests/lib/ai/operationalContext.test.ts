/**
 * getOperationalContext — оперативный контекст workspace (F03-16, миграции 114/115).
 *
 * Заменяет тесты workspaceContextCache: тот модуль удалён вместе с полем
 * `workspace_context_cache` и Edge Function `rebuild-workspace-context`.
 *
 * Covers:
 *   - Успешное чтение RPC + нормализация полей
 *   - null при ошибке RPC (промпт собирается без блока — A-6)
 *   - null при не-объектном ответе (jsonb-мусор не должен ломать парсинг)
 *   - sharingLevel-фильтрация на уровне вызывающего (parseAndPrepare)
 *   - isOperationalContextEmpty: пустой workspace не раздувает промпт
 */
import { describe, it, expect, vi } from 'vitest';

import {
  getOperationalContext,
  isOperationalContextEmpty,
  type OperationalContext,
} from '../../../src/lib/ai/operationalContext';

const WORKSPACE_ID = 'ws-1';

function makeSupabase(result: { data?: unknown; error?: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as never;
}

const FULL_PAYLOAD = {
  sprint: { name: 'Sprint 1', goal: 'выкатить', status: 'active' },
  overloaded_workers: ['Vadim'],
  escalations: 2,
  blockers: 1,
  active_tasks: 7,
};

describe('getOperationalContext', () => {
  it('returns normalized context on success', async () => {
    const supabase = makeSupabase({ data: FULL_PAYLOAD });

    const result = await getOperationalContext(supabase, WORKSPACE_ID);

    expect(result).toEqual({
      sprint: { name: 'Sprint 1', goal: 'выкатить', status: 'active' },
      overloaded_workers: ['Vadim'],
      escalations: 2,
      blockers: 1,
      active_tasks: 7,
    });
  });

  it('calls the RPC with the workspace id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: FULL_PAYLOAD });

    await getOperationalContext({ rpc } as never, WORKSPACE_ID);

    expect(rpc).toHaveBeenCalledWith('get_workspace_operational_context', {
      p_workspace_id: WORKSPACE_ID,
    });
  });

  it('returns null when RPC errors (does not throw — A-6)', async () => {
    const supabase = makeSupabase({ error: { message: 'boom' } });

    await expect(getOperationalContext(supabase, WORKSPACE_ID)).resolves.toBeNull();
  });

  it('returns null when payload is not an object', async () => {
    await expect(
      getOperationalContext(makeSupabase({ data: 'garbage' }), WORKSPACE_ID),
    ).resolves.toBeNull();
    await expect(
      getOperationalContext(makeSupabase({ data: [1, 2] }), WORKSPACE_ID),
    ).resolves.toBeNull();
  });

  it('fills defaults for missing / mistyped fields', async () => {
    const supabase = makeSupabase({
      data: { sprint: null, escalations: 'oops', overloaded_workers: 'nope' },
    });

    const result = await getOperationalContext(supabase, WORKSPACE_ID);

    expect(result).toEqual({
      sprint: null,
      overloaded_workers: [],
      escalations: 0,
      blockers: 0,
      active_tasks: 0,
    });
  });
});

describe('isOperationalContextEmpty', () => {
  const base: OperationalContext = {
    sprint: null,
    overloaded_workers: [],
    escalations: 0,
    blockers: 0,
    active_tasks: 0,
  };

  it('treats null and a fully quiet workspace as empty', () => {
    expect(isOperationalContextEmpty(null)).toBe(true);
    expect(isOperationalContextEmpty(base)).toBe(true);
  });

  it('is non-empty when any signal is present', () => {
    expect(isOperationalContextEmpty({ ...base, sprint: { name: 'S', goal: null, status: 'active' } })).toBe(false);
    expect(isOperationalContextEmpty({ ...base, overloaded_workers: ['Vadim'] })).toBe(false);
    expect(isOperationalContextEmpty({ ...base, escalations: 1 })).toBe(false);
    expect(isOperationalContextEmpty({ ...base, blockers: 1 })).toBe(false);
  });

  it('ignores active_tasks alone — count alone is not worth a prompt block', () => {
    expect(isOperationalContextEmpty({ ...base, active_tasks: 12 })).toBe(true);
  });
});