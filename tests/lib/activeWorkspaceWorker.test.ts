import { describe, expect, it } from 'vitest';
import { findActiveWorkspaceWorkerId } from '@/lib/activeWorkspaceWorker';

const worker = (over: Partial<{
  id: string;
  workspace_id: string;
  source_id: string;
  type: 'human' | 'agent';
}> = {}) => ({
  id: 'worker-default',
  workspace_id: 'ws-1',
  source_id: 'profile-1',
  type: 'human' as const,
  ...over,
});

describe('findActiveWorkspaceWorkerId', () => {
  it('выбирает worker текущей доски, а не worker первоначальной доски', () => {
    expect(findActiveWorkspaceWorkerId(
      [worker({ id: 'worker-ws-1' }), worker({ id: 'worker-ws-2', workspace_id: 'ws-2' })],
      'profile-1',
      'ws-2',
      'worker-ws-1',
    )).toBe('worker-ws-2');
  });

  it('не выбирает agent или worker другого профиля', () => {
    expect(findActiveWorkspaceWorkerId(
      [worker({ id: 'other-profile', source_id: 'profile-2' }), worker({ id: 'agent', type: 'agent' })],
      'profile-1',
      'ws-1',
      'fallback',
    )).toBe('fallback');
  });

  it('использует fallback во время загрузки или при отсутствии worker для доски', () => {
    expect(findActiveWorkspaceWorkerId([], undefined, 'ws-1', 'fallback')).toBe('fallback');
    expect(findActiveWorkspaceWorkerId([], 'profile-1', null, 'fallback')).toBe('fallback');
    expect(findActiveWorkspaceWorkerId([worker()], 'profile-1', 'ws-2', 'fallback')).toBe('fallback');
  });
});
