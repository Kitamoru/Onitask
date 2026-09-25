import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/telegram/validate', () => ({
  validateTelegramInitData: vi.fn(),
}));
vi.mock('@core/supabase', () => ({ createServerClient: vi.fn() }));

import { POST, PUT } from '@/app/api/workspaces/route';
import { validateTelegramInitData } from '@/lib/telegram/validate';
import { createServerClient } from '@core/supabase';

function request(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

function makeSupabase(options: { references?: Array<{ id: string; task_number: number; title: string }> }) {
  const referenceSelect = vi.fn((columns: string) => {
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn((column: string) => {
      chain.referenceColumn = column;
      return chain;
    });
    chain.in = vi.fn(async () => ({ data: options.references ?? [], error: null }));
    chain.select = vi.fn(() => chain);
    return chain;
  });

  const settingsUpdate = vi.fn();
  settingsUpdate.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: async () => ({ data: { id: 'profile-1', telegram_id: 1 }, error: null }),
          })),
        })),
      };
    }
    if (table === 'workers') {
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = async () => ({ data: { role: 'owner' }, error: null });
      return { select: vi.fn(() => chain) };
    }
    if (table === 'workspaces') {
      return {
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: async () => ({ data: { id: 'ws-1', name: 'Board', slug: 'board', task_prefix: 'TASK' }, error: null }),
            })),
          })),
        })),
      };
    }
    if (table === 'workspace_settings') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: { workspace_id: 'ws-1' }, error: null }) })) })),
        update: settingsUpdate,
      };
    }
    if (table === 'tasks') return { select: referenceSelect };
    return {};
  });
  return {
    db: { from, channel: vi.fn() } as unknown as ReturnType<typeof createServerClient>,
    settingsUpdate,
  };
}

describe('PUT /api/workspaces — Story Point reference validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.mocked(validateTelegramInitData).mockResolvedValue({
      valid: true,
      user: { id: 1, first_name: 'Tester' },
    } as never);
  });

  it.each([
    ['10–2 часов', 3],
    ['-5 часов', 1],
    ['1000 часов', 5],
    ['abc', 2],
  ])('rejects invalid duration %s for %i SP', async (value, sp) => {
    const { db, settingsUpdate } = makeSupabase({ references: [] });
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await PUT(request({
      init_data: 'init', workspace_id: 'ws-1', name: 'Board',
      story_points_config: {
        enabled: true,
        values: [1, 2, 3, 5, 8],
        hours_per_sp: { [String(sp)]: value },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_story_point_range', sp });
    expect(settingsUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid duration while creating a board', async () => {
    const response = await POST(request({
      init_data: 'init', name: 'Board', slug: 'board',
      story_points_config: {
        enabled: true,
        values: [1, 2, 3, 5, 8],
        hours_per_sp: { '3': '8–4 часов' },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_story_point_range', sp: 3 });
  });

  it('rejects a reference that is not returned by the done/workspace query', async () => {
    const { db, settingsUpdate } = makeSupabase({ references: [] });
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await PUT(request({
      init_data: 'init', workspace_id: 'ws-1', name: 'Board',
      story_points_config: {
        enabled: true,
        values: [1, 2, 3, 5, 8],
        hours_per_sp: {},
        reference_tasks: { '3': { task_id: 'not-done' } },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'reference_tasks_must_be_done_in_workspace' });
    expect(settingsUpdate).not.toHaveBeenCalled();
  });

  it('rejects duplicate references across SP values', async () => {
    const { db, settingsUpdate } = makeSupabase({
      references: [{ id: 'done-1', task_number: 1, title: 'Reference' }],
    });
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await PUT(request({
      init_data: 'init', workspace_id: 'ws-1', name: 'Board',
      story_points_config: {
        enabled: true,
        reference_tasks: {
          '1': { task_id: 'done-1' },
          '2': { task_id: 'done-1' },
        },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'reference_tasks_must_be_unique' });
    expect(settingsUpdate).not.toHaveBeenCalled();
  });

  it('persists a verified done reference snapshot', async () => {
    const { db, settingsUpdate } = makeSupabase({
      references: [{ id: 'done-3', task_number: 42, title: 'Reference task' }],
    });
    vi.mocked(createServerClient).mockReturnValue(db);

    const response = await PUT(request({
      init_data: 'init', workspace_id: 'ws-1', name: 'Board',
      story_points_config: {
        enabled: true,
        values: [1, 2, 3, 5, 8],
        hours_per_sp: { '3': '4–8 часов' },
        reference_tasks: { '3': { task_id: 'done-3' } },
      },
    }));

    expect(response.status).toBe(200);
    expect(settingsUpdate).toHaveBeenCalledWith({
      story_points_config: expect.objectContaining({
        hours_per_sp: expect.objectContaining({ '1': '1–2 часа', '3': '4–8 часов' }),
        reference_tasks: {
          '3': { task_id: 'done-3', full_id: 'TASK-42', title: 'Reference task' },
        },
      }),
    });
  });
});
