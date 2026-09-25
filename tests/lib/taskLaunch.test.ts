import { describe, expect, it } from 'vitest';
import { inviteDeepLink } from '../../src/lib/taskLaunch';
import { createLatestLoadGuard } from '../../src/lib/latestLoadGuard';
import { resolveFlowLaunchTarget, resolveTaskLaunchTarget } from '../../src/lib/server/taskLaunch';

function makeSupabase(options: { taskId?: string | null; taskWorkspace?: string | null; member?: boolean; flowMember?: boolean }) {
  return {
    rpc: async () => ({ data: options.taskId ?? null, error: null }),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'tasks'
            ? (options.taskWorkspace ? { id: options.taskId, workspace_id: options.taskWorkspace } : null)
            : table === 'workspaces'
              ? { id: options.taskWorkspace, slug: 'beta-board' }
              : (options.member || options.flowMember ? { id: 'member-1' } : null),
          error: null,
        }),
      };
      return query;
    },
  } as never;
describe('invite link builder', () => {
  it('creates invite namespace without breaking legacy parser support', () => {
    expect(inviteDeepLink('CODE')).toBe(
      'https://t.me/onitaskbot/onitask?startapp=invite_CODE',
    );
  });
});


}
describe('workspace load generation guard', () => {
  it('ignores a late response from workspace A after workspace B starts', () => {
    const guard = createLatestLoadGuard();
    const generationA = guard.begin();
    const generationB = guard.begin();
    expect(guard.isCurrent(generationA)).toBe(false);
    expect(guard.isCurrent(generationB)).toBe(true);
  });
});



describe('task launch resolver', () => {
  it('resolves a task using its own workspace and preserves comments tab', async () => {
    const result = await resolveTaskLaunchTarget(
      makeSupabase({ taskId: 'task-1', taskWorkspace: 'ws-beta', member: true }),
      'profile-1',
      'BETA-42',
      'comments',
    );
    expect(result).toEqual({
      kind: 'task',
      taskId: 'task-1',
      workspaceId: 'ws-beta',
      workspaceSlug: 'beta-board',
      fullId: 'BETA-42',
      tab: 'comments',
    });
  });

  it('rejects a task when the user has no active workspace membership', async () => {
    const result = await resolveTaskLaunchTarget(
      makeSupabase({ taskId: 'task-1', taskWorkspace: 'ws-beta', member: false }),
      'profile-1',
      'BETA-42',
      'general',
    );
    expect(result).toBeNull();
  });

  it('resolves a flow board only for a member', async () => {
    await expect(resolveFlowLaunchTarget(
      makeSupabase({ taskWorkspace: 'ws-beta', flowMember: true }),
      'profile-1',
      'beta-board',
    )).resolves.toEqual({ kind: 'flow', workspaceId: 'ws-beta', workspaceSlug: 'beta-board' });
    await expect(resolveFlowLaunchTarget(
      makeSupabase({ taskWorkspace: 'ws-beta', flowMember: false }),
      'profile-1',
      'beta-board',
    )).resolves.toBeNull();
  });
});
