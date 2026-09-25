import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/contexts/DataContext';
import type { TaskLaunchTab } from '@/lib/taskLaunch';

export interface OpenTaskOptions {
  taskId: string;
  workspaceId: string;
  tab?: TaskLaunchTab;
  source?: string;
}

/** One task-opening path for queue cards, bot actions and future deep links. */
export function useTaskNavigator() {
  const router = useRouter();
  const { state, setActiveWorkspace, loadBoardsData } = useData();

  const openTask = useCallback(async ({
    taskId,
    workspaceId,
    tab = 'general',
    source = 'app',
  }: OpenTaskOptions) => {
    if (state.activeWorkspaceId !== workspaceId) {
      await setActiveWorkspace(workspaceId);
    } else if (!state.tasks.items.some((task) => task.id === taskId)) {
      await loadBoardsData(workspaceId, { partial: true });
    }

    const query = new URLSearchParams({ open_task_id: taskId });
    if (tab === 'comments') query.set('tab', 'comments');
    if (source) query.set('source', source);
    router.replace(`/flowboard?${query.toString()}`, { scroll: false });
  }, [loadBoardsData, router, setActiveWorkspace, state.activeWorkspaceId, state.tasks.items]);

  return { openTask };
}
