'use client';

import React, { Suspense, useEffect, useMemo, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FlowBoard, OnboardingModal, InviteModal, ColumnTasksSheet, TaskViewEdit } from '@/components/flowboard';
import { StreamView } from '@/components/stream';
import type {
  SprintInfo,
  SignalData,
  TaskStatusData,
  WorkerCardData,
  AgentCardData,
  TaskEntity,
} from '@/types/flowboard';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}

function tasksToWorkerTaskList(tasks: TaskEntity[]): string[] {
  return tasks.slice(0, 3).map((t) => {
    const fullId = t.task_number ? `TASK-${t.task_number}` : t.id.slice(0, 8);
    return `${fullId} · ${t.title.slice(0, 30)}${t.title.length > 30 ? '…' : ''}`;
  });
}

function FlowBoardPageContent() {
  useScrollReset();
  const searchParams = useSearchParams();
  const view = searchParams.get('view');
  const isStreamView = view === 'stream';
  const { isLoading: authLoading, error: authError, data: authData, refresh: refreshAuth, initData: tgInitData } = useTelegramAuth();
  const { state, dispatch, loadBoardsData, firstLoadDone, dataError, isSwitchingWorkspace } = useData();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [columnSheet, setColumnSheet] = useState<{ open: boolean; column: string | null; label: string; accentColor: string }>({
    open: false,
    column: null,
    label: '',
    accentColor: 'var(--color-accent-amber)',
  });
  const [selectedTask, setSelectedTask] = useState<TaskEntity | null>(null);

  const metrics = state.metrics.data;
  const tasks = state.tasks.items;

  const sprintEnabled = metrics?.sprintEnabled ?? false;
  const sprint = useMemo<SprintInfo | undefined>(() => metrics?.sprint ?? undefined, [metrics]);

  const signals = useMemo<SignalData[]>(() => {
    if (!metrics) return [];
    const newSignals: SignalData[] = [];
    const overloadedCount = metrics.workers.filter(w => w.status === 'overloaded').length;
    if (overloadedCount > 0) {
      const overloadedNames = metrics.workers
        .filter(w => w.status === 'overloaded')
        .map(w => w.display_name)
        .join(', ');
      newSignals.push({ id: 'people', label: 'Люди', count: overloadedCount });
    } else {
      newSignals.push({ id: 'people', label: 'Люди', count: 0 });
    }
    const bottleneckCount = metrics.columns.filter(c => c.health === 'red').length;
    const stuckCount = 0;
    if (bottleneckCount + stuckCount > 0) {
      newSignals.push({ id: 'processes', label: 'Процессы', count: bottleneckCount + stuckCount });
    } else {
      newSignals.push({ id: 'processes', label: 'Процессы', count: 0 });
    }
    const escalationCount = metrics.alerts.filter(a => a.type === 'overloaded_member').length;
    if (escalationCount > 0) {
      newSignals.push({ id: 'escalations', label: 'Эскалации', count: escalationCount });
    } else {
      newSignals.push({ id: 'escalations', label: 'Эскалации', count: 0 });
    }
    return newSignals;
  }, [metrics]);

  const taskStatuses = useMemo<TaskStatusData[]>(() => {
    if (!metrics) return [];
    // Single source of truth: derive column counters from the same `tasks` array
    // that powers the bottom sheet, so both stay consistent during optimistic moves.
    const countByColumn = (col: string) => tasks.filter((t) => t.column === col).length;
    const inProgressCount = countByColumn('in_progress');
    const backlogCount = countByColumn('backlog');
    const reviewCount = countByColumn('review');
    const doneCount = countByColumn('done');
    return [
      { id: 'in_progress', label: 'В работе', count: inProgressCount, shapes: Math.min(inProgressCount, 10), maxShapes: 10, color: 'var(--color-accent-amber)' },
      { id: 'review', label: 'На проверке', count: reviewCount, shapes: Math.min(reviewCount, 10), maxShapes: 10, color: 'var(--color-signal-cyan)' },
      { id: 'backlog', label: 'В очереди', count: backlogCount, shapes: Math.min(backlogCount, 10), maxShapes: 10, color: 'var(--color-text-primary)' },
      { id: 'done', label: 'Сделано', count: doneCount, shapes: Math.min(doneCount, 10), maxShapes: 10, color: 'var(--color-signal-green)' },
    ];
  }, [metrics, tasks]);

  const workers = useMemo<WorkerCardData[]>(() => {
    if (!metrics) return [];
    return metrics.workers
      .filter(w => w.type === 'human')
      .map(w => {
        const workerTasks = tasks.filter(t => t.assigned_to === w.display_name);
        return {
          id: w.display_name,
          displayName: w.display_name,
          cognitiveWeight: w.cognitive_load,
          spPerDay: 3.5,
          trendUp: true,
          activeDays: 5,
          roleLabel: 'Участник команды',
          overloaded: w.status === 'overloaded',
          tasks: tasksToWorkerTaskList(workerTasks),
          type: 'human',
        } as WorkerCardData;
      });
  }, [metrics, tasks]);

  const agents = useMemo<AgentCardData[]>(() => {
    if (!metrics) return [];
    return metrics.workers
      .filter(w => w.type === 'agent')
      .map(w => {
        const workerTasks = tasks.filter(t => t.assigned_to === w.display_name);
        return {
          id: w.display_name,
          name: w.display_name,
          cognitiveWeight: w.cognitive_load,
          spPerDay: 5.0,
          trendUp: true,
          activeDays: 5,
          roleLabel: 'AI-агент',
          overloaded: w.status === 'overloaded',
          tasks: tasksToWorkerTaskList(workerTasks),
        } as AgentCardData;
      });
  }, [metrics, tasks]);

  const handleColumnClick = useCallback((column: string, label: string, accentColor: string) => {
    setColumnSheet({ open: true, column, label, accentColor });
  }, []);

  const handleColumnSheetClose = useCallback(() => {
    setColumnSheet((prev) => ({ ...prev, open: false }));
  }, []);

  const handleTaskTap = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    setSelectedTask(task ?? null);
  }, [tasks]);

  const refreshMetrics = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    if (!state.activeWorkspaceId) return;
    // TTL check: only refetch if data is older than 30 seconds.
    // force=true bypasses the TTL — used after sprint mutations (create/edit/activate/delete)
    // so the UI reflects the new state immediately instead of waiting for the next interval.
    const lastUpdated = state.metrics.lastUpdated ?? 0;
    const ageMs = Date.now() - lastUpdated;
    if (!force && ageMs < 30000) return; // Data is still fresh (reduced from 60s to 30s for snappier UX)
    try {
      await loadBoardsData(state.activeWorkspaceId, { partial: true });
    } catch (err) {
      console.error('Refresh metrics error:', err);
    }
  }, [loadBoardsData, state.activeWorkspaceId, state.metrics.lastUpdated]);

  // Callback for after invite/boarding — forces a full metrics refresh so new colleagues appear
  const handleBoardCreate = useCallback(async () => {
    await refreshMetrics({ force: true });
  }, [refreshMetrics]);

  // Refresh metrics periodically (30s interval with TTL check)
  React.useEffect(() => {
    const interval = setInterval(() => {
      refreshMetrics();
    }, 30000); // every 30s
    return () => clearInterval(interval);
  }, [refreshMetrics]);

  // Auto-refresh on visibility change (user returns to the tab/page)
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshMetrics({ force: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshMetrics]);

  // Optimistic move task with rollback + version sync (INV-09).
  const handleMoveTask = useCallback(
    async (taskId: string, newColumn: string) => {
      if (!state.activeWorkspaceId) return;
      const task = state.tasks.items.find((t) => t.id === taskId);
      const originalColumn = task?.column;
      // Optimistic local update: move the task in the shared `tasks` array immediately
      // so column counters and the bottom sheet stay consistent without waiting for realtime.
      if (task) {
        dispatch({ type: 'PATCH_TASK', payload: { ...task, column: newColumn } });
      }
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            column: newColumn,
            expected_version: task?.version,
            init_data: tgInitData,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to move task');
        // Sync server-confirmed state (fresh version, moved_to_column_at, etc.)
        if (result.task) {
          dispatch({ type: 'PATCH_TASK', payload: result.task });
        }
        // Version mismatch (INV-09): server applied last-write-wins, but another
        // client changed the task concurrently — refresh to reconcile local state.
        if (result.warning) {
          console.warn('[Optimistic Swipe]', result.warning);
          void refreshMetrics({ force: true });
        }
      } catch (err) {
        console.error('[Optimistic Swipe] Move task failed:', err);
        // Rollback: return task to its original column so UI stays truthful.
        if (task && originalColumn) {
          dispatch({ type: 'PATCH_TASK', payload: { ...task, column: originalColumn } });
        }
      }
    },
    [state.activeWorkspaceId, state.tasks.items, tgInitData, dispatch, refreshMetrics],
  );


  // Loading state — wait for auth + first server load to complete
  // This ensures sprint data from DB is available before rendering FlowBoard
  if (authLoading || (!firstLoadDone && !dataError)) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
      </div>
    );
  }

  // Auth error state
  if (authError) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh p-4"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center max-w-sm">
          <p style={{ color: '#EF4444', fontFamily: 'system-ui' }}>
            Ошибка авторизации. Откройте приложение через Telegram Web App.
          </p>
        </div>
      </div>
    );
  }

  // Data error state — first load failed, show retry option
  if (!firstLoadDone && dataError) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full min-h-dvh px-4"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center max-w-sm">
          <p style={{ color: '#EF4444', fontFamily: 'system-ui', marginBottom: '16px' }}>
            Ошибка загрузки данных доски
          </p>
          <button
            onClick={() => refreshMetrics({ force: true })}
            style={{
              fontFamily: 'system-ui',
              fontSize: '14px',
              padding: '8px 16px',
              borderRadius: '8px',
              backgroundColor: '#F59E0B',
              color: '#0A0A0A',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '600',
            }}
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const currentDate = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const isNewUser = authData?.is_new_user === true;
  const needsOnboarding = !authData?.worker?.workspace_id && !authLoading && !authError && isNewUser;

  return (
    <>
      {isStreamView ? (
        <StreamView
          key={state.activeWorkspaceId || 'default'}
          tasks={tasks}
          currentDate={currentDate.charAt(0).toUpperCase() + currentDate.slice(1)}
          cognitiveWeight={0}
          loadStatus="Свободен"
          loading={isSwitchingWorkspace}
          error={dataError}
          onRefresh={(options: { force?: boolean } | undefined) => refreshMetrics(options ?? { force: true })}
        />
      ) : (
        <FlowBoard
          key={state.activeWorkspaceId || 'default'}
          title="Флоу задач"
          currentDate={currentDate.charAt(0).toUpperCase() + currentDate.slice(1)}
          sprintEnabled={sprintEnabled}
          sprint={sprint}
          signals={signals}
          taskStatuses={taskStatuses}
          workers={workers}
          agents={agents}
          loading={isSwitchingWorkspace}
          error={dataError}
          onAddWorker={() => setShowInviteModal(true)}
          onAddAgent={() => console.log('Add agent clicked')}
          onRefresh={(options: { force?: boolean } | undefined) => refreshMetrics(options ?? { force: true })}
          isNewUser={isNewUser}
          onBoardCreate={handleBoardCreate}
          initData={tgInitData}
          workspaceId={state.activeWorkspaceId ?? undefined}
          onColumnClick={handleColumnClick}
        />
      )}

      {/* Invite modal for adding colleagues */}
      <InviteModal
        open={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          // After closing invite modal, refresh FlowBoard data to show new colleagues
          handleBoardCreate();
        }}
        workspaceId={state.activeWorkspaceId}
        initData={tgInitData}
      />

      {/* Onboarding modal for new users */}
      {needsOnboarding && (
        <OnboardingModal onSuccess={refreshAuth} />
      )}

      {/* Column tasks bottom sheet */}
        <ColumnTasksSheet
          open={columnSheet.open}
          onClose={handleColumnSheetClose}
          column={columnSheet.column}
          title={columnSheet.label}
          tasks={tasks}
          accentColor={columnSheet.accentColor}
          onMoveTask={handleMoveTask}
          onTaskTap={handleTaskTap}
        />

        {/* Task view/edit bottom sheet */}
        <TaskViewEdit
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          workers={workers}
          mode="view"
          onSave={(updatedTask) => {
            dispatch({ type: 'PATCH_TASK', payload: updatedTask });
            setSelectedTask(null);
          }}
        />
    </>
  );
}

export default function FlowBoardPage() {
  // useSearchParams must be wrapped in a Suspense boundary to allow static
  // prerendering of this route (and the global /404 / _not-found pages).
  return (
    <Suspense fallback={null}>
      <FlowBoardPageContent />
    </Suspense>
  );
}