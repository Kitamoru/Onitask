'use client';

import React, { useEffect, useMemo, useCallback } from 'react';
import { FlowBoard, OnboardingModal } from '@/components/flowboard';
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

export default function FlowBoardPage() {
  useScrollReset();
  const { isLoading: authLoading, error: authError, data: authData, refresh: refreshAuth, initData: tgInitData } = useTelegramAuth();
  const { state, loadBoardsData, firstLoadDone } = useData();

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
    const backlogCount = metrics.columns.find(c => c.name === 'backlog')?.wip_current ?? 0;
    const inProgressCount = metrics.columns.find(c => c.name === 'in_progress')?.wip_current ?? 0;
    const reviewCount = metrics.columns.find(c => c.name === 'review')?.wip_current ?? 0;
    const doneCount = metrics.columns.find(c => c.name === 'done')?.wip_current ?? 0;
    return [
      { id: 'active', label: 'Активные', count: inProgressCount, shapes: Math.min(inProgressCount, 10), maxShapes: 10, color: 'var(--color-accent-amber)' },
      { id: 'queue', label: 'В очереди', count: backlogCount, shapes: Math.min(backlogCount, 10), maxShapes: 10, color: 'var(--color-text-primary)' },
      { id: 'review', label: 'На проверке', count: reviewCount, shapes: Math.min(reviewCount, 10), maxShapes: 10, color: 'var(--color-signal-cyan)' },
      { id: 'done', label: 'Сделано', count: doneCount, shapes: Math.min(doneCount, 10), maxShapes: 10, color: 'var(--color-signal-green)' },
    ];
  }, [metrics]);

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

  const refreshMetrics = useCallback(async () => {
    if (!state.activeWorkspaceId) return;
    try {
      await loadBoardsData(state.activeWorkspaceId);
    } catch (err) {
      console.error('Refresh metrics error:', err);
    }
  }, [loadBoardsData, state.activeWorkspaceId]);

  // Refresh metrics periodically
  React.useEffect(() => {
    const interval = setInterval(() => {
      refreshMetrics();
    }, 30000); // every 30s
    return () => clearInterval(interval);
  }, [refreshMetrics]);

  // Loading state — wait for auth + first server load to complete
  // This ensures sprint data from DB is available before rendering FlowBoard
  if (authLoading || !firstLoadDone) {
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

  const currentDate = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const isNewUser = authData?.is_new_user === true;
  const needsOnboarding = !authData?.worker?.workspace_id && !authLoading && !authError && isNewUser;

  return (
    <>
      <FlowBoard
        title="Флоу задач"
        currentDate={currentDate.charAt(0).toUpperCase() + currentDate.slice(1)}
        sprintEnabled={sprintEnabled}
        sprint={sprint}
        signals={signals}
        taskStatuses={taskStatuses}
        workers={workers}
        agents={agents}
        loading={false}
        error={null}
        onAddWorker={() => console.log('Add worker clicked')}
        onAddAgent={() => console.log('Add agent clicked')}
        onRefresh={refreshMetrics}
        isNewUser={isNewUser}
        initData={tgInitData}
      />
      
      {/* Onboarding modal for new users */}
      {needsOnboarding && (
        <OnboardingModal onSuccess={refreshAuth} />
      )}
    </>
  );
}