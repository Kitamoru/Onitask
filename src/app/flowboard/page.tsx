'use client';

import React, { Suspense, useEffect, useMemo, useCallback, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { FlowBoard, OnboardingModal, InviteModal, ColumnTasksSheet, TaskViewEdit, WorkerSheet, SwipeDebugPanel, ResultStepSheet } from '@/components/flowboard';
import { StreamView } from '@/components/stream';
import type {
  SprintInfo,
  SignalData,
  TaskStatusData,
  WorkerCardData,
  AgentCardData,
  TaskEntity,
  TaskSubmissionLink,
} from '@/types/flowboard';
import { uploadTaskAttachments, submitTask } from '@/lib/api/flow';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';
import { setPreferredView } from '@/lib/viewPreference';
import { formatWorkerRole } from '@/lib/roles';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}

function tasksToWorkerTaskList(tasks: TaskEntity[]): string[] {
  // Скрываем завершённые задачи из активного списка в карточках участников (ONIT-12)
  return tasks
    .filter((t) => t.column !== 'done')
    .slice(0, 3)
    .map((t) => {
    // Use task.full_id if available (already computed), otherwise fallback
    const fullId = t.full_id ?? (t.task_number ? `${t.workspace_prefix ?? 'TASK'}-${t.task_number}` : t.id.slice(0, 8));
    const title = t.title ?? 'Без названия';
    return `${fullId} · ${title.slice(0, 30)}${title.length > 30 ? '…' : ''}`;
  });
}

function FlowBoardPageContent() {
  useScrollReset();
  const searchParams = useSearchParams();
  const view = searchParams.get('view');
  const isStreamView = view === 'stream';
  const openTaskParam = searchParams.get('open_task');
  const router = useRouter();
  const { isLoading: authLoading, error: authError, data: authData, refresh: refreshAuth, initData: tgInitData } = useTelegramAuth();
  const { state, dispatch, loadBoardsData, firstLoadDone, dataError, isSwitchingWorkspace } = useData();

  // Toggle between flowboard and stream views
  const toggleView = useCallback(() => {
    if (isStreamView) {
      setPreferredView('flowboard');
      router.push('/flowboard');
    } else {
      setPreferredView('stream');
      router.push('/flowboard?view=stream');
    }
  }, [isStreamView, router]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [columnSheet, setColumnSheet] = useState<{ open: boolean; column: string | null; label: string; accentColor: string }>({
    open: false,
    column: null,
    label: '',
    accentColor: 'var(--color-accent-amber)',
  });
  const [selectedTask, setSelectedTask] = useState<TaskEntity | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<WorkerCardData | null>(null);
  // FILE-03: deep-link «Обсудить задачу» → открыть вкладку «Комментарии»
  const [openTaskTab, setOpenTaskTab] = useState<'general' | 'comments'>('general');
  // SUBMIT-01: сдача исполнителя — шаг «Результат» открывается при переходе
  // в review/done из не-review колонки (backlog/in_progress → сдача).
  // review→done/review→in_progress сюда НЕ попадают (это ревью-решение).
  const [resultStep, setResultStep] = useState<{
    taskId: string;
    targetColumn: 'review' | 'done';
  } | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitUploadCount, setSubmitUploadCount] = useState(0);
  const [submitUploadTotal, setSubmitUploadTotal] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const resultTask = resultStep
    ? state.tasks.items.find((t) => t.id === resultStep.taskId) ?? null
    : null;



  const metrics = state.metrics.data;
  const tasks = state.tasks.items;

  // Open task from Telegram deep link: ?open_task=TASK-42
  // After data loads, find the task by full_id and open TaskViewEdit sheet, then clean URL.
  useEffect(() => {
    if (!openTaskParam || !firstLoadDone || dataError) return;

    const matchTask = (t: TaskEntity) => {
      if (t.full_id === openTaskParam) return true;
      const computed = t.workspace_prefix && t.task_number
        ? `${t.workspace_prefix}-${t.task_number}`
        : null;
      if (computed === openTaskParam) return true;
      return false;
    };

    const task = tasks.find(matchTask);
    if (task) {
      setSelectedTask(task);
      // FILE-03: ?tab=comments → открыть вкладку «Комментарии»
      const tabParam = searchParams.get('tab');
      setOpenTaskTab(tabParam === 'comments' ? 'comments' : 'general');
      // Clean URL: remove ?open_task=
      const params = new URLSearchParams(searchParams.toString());
      params.delete('open_task');
      params.delete('tab');
      const cleanQuery = params.toString();
      router.replace(`/flowboard${cleanQuery ? '?' + cleanQuery : ''}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskParam, firstLoadDone, dataError, tasks]);

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
      { id: 'backlog', label: 'В очереди', count: backlogCount, shapes: Math.min(backlogCount, 10), maxShapes: 10, color: 'var(--color-text-primary)' },
      { id: 'in_progress', label: 'В работе', count: inProgressCount, shapes: Math.min(inProgressCount, 10), maxShapes: 10, color: 'var(--color-accent-amber)' },
      { id: 'review', label: 'На проверке', count: reviewCount, shapes: Math.min(reviewCount, 10), maxShapes: 10, color: 'var(--color-signal-cyan)' },
      { id: 'done', label: 'Сделано', count: doneCount, shapes: Math.min(doneCount, 10), maxShapes: 10, color: 'var(--color-signal-green)' },
    ];
  }, [metrics, tasks]);

  const workers = useMemo<WorkerCardData[]>(() => {
    if (!metrics) return [];
    return metrics.workers
      .filter(w => w.type === 'human')
      .map(w => {
        const workerTasks = tasks.filter(t => {
          const isAssignee = t.assigned_to === w.id;
          const isReviewer = t.reviewer_id === w.id;
          if (isReviewer) return t.column === 'review';
          if (isAssignee) return t.column === 'in_progress' || t.column === 'review';
          return false;
        });
        return {
          id: w.id,
          displayName: w.display_name,
          cognitiveWeight: w.cognitive_load,
          spPerDay: 3.5,
          trendUp: true,
          activeDays: 5,
          roleLabel: formatWorkerRole(w.role, w.role_title),
          role: w.role,
          roleTitle: w.role_title,
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
        const workerTasks = tasks.filter(t => t.assigned_to === w.id);
        return {
          id: w.id,
          name: w.display_name,
          cognitiveWeight: w.cognitive_load,
          spPerDay: 5.0,
          trendUp: true,
          activeDays: 5,
          roleLabel: 'AI-агент',
          role: w.role,
          roleTitle: w.role_title,
          overloaded: w.status === 'overloaded',
          tasks: tasksToWorkerTaskList(workerTasks),
        } as AgentCardData;
      });
  }, [metrics, tasks]);

  // All assignable workers (humans + AI agents) for task assignment sheets
  const assignableWorkers = useMemo<WorkerCardData[]>(() => {
    if (!metrics) return [];
    return metrics.workers.map(w => {
      const workerTasks = tasks.filter(t => t.assigned_to === w.id);
      return {
        id: w.id,
        displayName: w.display_name,
        cognitiveWeight: w.cognitive_load,
        spPerDay: w.type === 'agent' ? 5.0 : 3.5,
        trendUp: true,
        activeDays: 5,
        roleLabel: w.type === 'agent' ? 'AI-агент' : formatWorkerRole(w.role, w.role_title),
        role: w.role,
        roleTitle: w.role_title,
        overloaded: w.status === 'overloaded',
        tasks: tasksToWorkerTaskList(workerTasks),
        type: w.type,
      } as WorkerCardData;
    });
  }, [metrics, tasks]);

  const handleColumnClick = useCallback((column: string, label: string, accentColor: string) => {
    setColumnSheet({ open: true, column, label, accentColor });
  }, []);

    const handleColumnSheetClose = useCallback(() => {
    setColumnSheet((prev) => ({ ...prev, open: false }));
  }, []);

  const handleWorkerClick = useCallback((worker: WorkerCardData) => {
    setSelectedWorker(worker);
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
      // SUBMIT-01: сдача исполнителя — переход в review/done из НЕ-review колонки
      // открывает шаг «Результат» (колонку НЕ двигаем, пока сдача не принята).
      // review→done/review→in_progress сюда не попадают (это ревью-решение, REV-01).
      if (
        task &&
        (newColumn === 'review' || newColumn === 'done') &&
        originalColumn !== 'review' &&
        originalColumn !== newColumn
      ) {
        setSubmitError(null);
        setResultStep({ taskId, targetColumn: newColumn });
        return;
      }
      // Optimistic local update: move the task in the shared `tasks` array immediately
      // so column counters and the bottom sheet stay consistent without waiting for realtime.
      if (task) {
        // Preserve full_id and workspace_prefix during optimistic update.
        // Guard: если задача не найдена в сторе — не диспатчим PATCH_TASK,
        // чтобы не ронять reducer невалидным payload.
        dispatch({ type: 'PATCH_TASK', payload: { ...task, column: newColumn, full_id: task.full_id, workspace_prefix: task.workspace_prefix } });
      } else {
        console.warn('[Optimistic Swipe] Task not found in store, skipping optimistic update:', taskId);
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
          dispatch({ type: 'PATCH_TASK', payload: { ...task, column: originalColumn, full_id: task.full_id, workspace_prefix: task.workspace_prefix } });
        }
      }
    },
    [state.activeWorkspaceId, state.tasks.items, tgInitData, dispatch, refreshMetrics],
  );

  // SUBMIT-01: финальный шаг сдачи — файлы по одному (прогресс uploadCount/uploadTotal),
  // затем submit_task (миг. 082): атомарно submission (с привязкой файлов) + move.
  // Результат сабмита — обогащённый task (как в PATCH) → синк стора.
  const handleResultSubmit = useCallback(
    async (payload: { bodyText: string; files: File[]; links: TaskSubmissionLink[]; edited: boolean }) => {
      if (!resultStep || !state.activeWorkspaceId) return;
      const { taskId, targetColumn } = resultStep;
      const currentTask = state.tasks.items.find((t) => t.id === taskId);
      setSubmitBusy(true);
      setSubmitError(null);
      try {
        // 1. Загрузка файлов (в памяти были до этого — в БД пишем только по сабмиту)
        const attachmentIds: string[] = [];
        const files = payload.files ?? [];
        if (files.length > 0) {
          setSubmitUploadTotal(files.length);
          for (let i = 0; i < files.length; i++) {
            setSubmitUploadCount(i);
            const up = await uploadTaskAttachments(taskId, [files[i]]);
            if (up.error || !up.attachments.length) {
              throw new Error(up.error || 'Не удалось загрузить файл');
            }
            attachmentIds.push(up.attachments[0].id);
          }
          setSubmitUploadCount(files.length);
        }
        // 2. Сдача (RPC service-only через Route Handler)
        const res = await submitTask(taskId, {
          target_column: targetColumn,
          body_text: payload.bodyText,
          links: payload.links,
          attachment_ids: attachmentIds,
          expected_version: currentTask?.version ?? undefined,
          edited: payload.edited,
        });
        if ('error' in res) throw new Error(res.error);
        // 3. Синк подтверждённого состояния
        if (res.task?.id) {
          dispatch({ type: 'PATCH_TASK', payload: res.task });
        }
        setResultStep(null);
        void refreshMetrics({ force: true });
      } catch (err) {
        console.error('[ResultStep] submit failed:', err);
        setSubmitError(err instanceof Error ? err.message : 'Не удалось сдать задачу');
      } finally {
        setSubmitBusy(false);
        setSubmitUploadCount(0);
        setSubmitUploadTotal(0);
      }
    },
    [resultStep, state.activeWorkspaceId, state.tasks.items, dispatch, refreshMetrics],
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

  // Вычисляем роль текущего пользователя в активном воркспейсе
  const activeWs = authData?.workspaces?.find(
    (w) => w.id === state.activeWorkspaceId,
  );
  const canRevoke = activeWs?.role === 'owner' || activeWs?.role === 'admin';
  const workspaceName = activeWs?.name ?? '';

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
          onMoveTask={handleMoveTask}
          onTaskTap={handleTaskTap}
          onToggleView={toggleView}
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
          onAddAgent={() => router.push('/settings/mcp')}
          onRefresh={(options: { force?: boolean } | undefined) => refreshMetrics(options ?? { force: true })}
          isNewUser={isNewUser}
          onBoardCreate={handleBoardCreate}
          initData={tgInitData}
          workspaceId={state.activeWorkspaceId ?? undefined}
                    onColumnClick={handleColumnClick}
          onWorkerClick={handleWorkerClick}
          onToggleView={toggleView}
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
          workers={assignableWorkers}
          mode="view"
          initialTab={openTaskTab}
          onSave={(updatedTask) => {
            dispatch({ type: 'PATCH_TASK', payload: updatedTask });
            setSelectedTask(null);
          }}
          onDelete={(taskId) => {
            // Optimistic: remove from state immediately so UI updates instantly
            dispatch({ type: 'REMOVE_TASK', payload: taskId });
            setSelectedTask(null);
          }}
          onMoveTask={handleMoveTask}
          onReviewResolved={(updatedTask) => {
            dispatch({ type: 'PATCH_TASK', payload: updatedTask });
            // review решение закрывает карточку — задача уже сменила колонку.
            setSelectedTask(null);
          }}
          currentUserId={authData?.worker?.id}
        />

        {/* SUBMIT-01: шаг «Результат» — сдача исполнителя (backlog/in_progress → review/done) */}
        <ResultStepSheet
          open={!!resultStep}
          task={resultTask}
          targetColumn={resultStep?.targetColumn ?? null}
          submitting={submitBusy}
          uploadCount={submitUploadCount}
          uploadTotal={submitUploadTotal}
          error={submitError}
          onSubmit={handleResultSubmit}
          onClose={() => {
            setSubmitError(null);
            setResultStep(null);
          }}
        />

                                {/* Worker bottom sheet (Figma 622:29869 / 622:30273) */}
        <WorkerSheet
          open={!!selectedWorker}
          onClose={() => setSelectedWorker(null)}
          worker={selectedWorker}
          tasks={tasks}
          sprint={sprint}
          workspaceId={state.activeWorkspaceId ?? undefined}
          workspaceName={workspaceName}
          canRevoke={canRevoke}
          currentWorkerId={authData?.worker?.id}
          onRevokeSuccess={() => {
            setSelectedWorker(null);
            refreshMetrics({ force: true });
          }}
          onSaveSuccess={(updated) => {
            // Optimistic: обновляем открытый sheet + карточки, затем подтверждаем refresh'ем
            setSelectedWorker(
              (prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev),
            );
            refreshMetrics({ force: true });
          }}
          workspaceWorkers={workers}
          onTransferSuccess={() => refreshMetrics({ force: true })}
          onLeaveSuccess={() => {
            // Signal boards page to skip TTL and reload immediately
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('boards-needs-refresh', Date.now().toString());
            }
            router.push('/boards');
          }}
        />

        {/* Debug panel for swipe logging (development only) */}
        {process.env.NODE_ENV === 'development' && (
          <SwipeDebugPanel compact />
        )}
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