'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { FlowBoard } from '@/components/flowboard';
import type {
  SprintInfo,
  SignalData,
  TaskStatusData,
  WorkerCardData,
  AgentCardData,
} from '@/types/flowboard';
import { getFlowMetrics, getTasks } from '@/lib/api/flow';
import { useTasksRealtime } from '@/lib/realtime/tasks';
import { getClient } from '@/lib/supabase/client';
import type { Database } from '../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

/** Convert DB task row to WorkerCardData tasks list */
function tasksToWorkerTaskList(tasks: TasksRow[]): string[] {
  return tasks.slice(0, 3).map((t) => {
    const fullId = t.task_number ? `TASK-${t.task_number}` : t.id.slice(0, 8);
    return `${fullId} · ${t.title.slice(0, 30)}${t.title.length > 30 ? '…' : ''}`;
  });
}

export default function FlowBoardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sprint, setSprint] = useState<SprintInfo | undefined>();
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<TaskStatusData[]>([]);
  const [workers, setWorkers] = useState<WorkerCardData[]>([]);
  const [agents, setAgents] = useState<AgentCardData[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<TasksRow[]>([]);

  // Fetch current workspace ID on mount
  useEffect(() => {
    async function fetchWorkspace() {
      try {
        const supabase = getClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setError('Не авторизован');
          setLoading(false);
          return;
        }

        const { data: workersData } = await supabase
          .from('workers')
          .select('workspace_id')
          .eq('source_id', user.id)
          .eq('is_active', true)
          .limit(1);

        const wsId = workersData?.[0]?.workspace_id ?? null;
        setWorkspaceId(wsId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    }
    fetchWorkspace();
  }, []);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    
    setLoading(true);
    setError(null);

    try {
      // Fetch metrics
      const { metrics, error: metricsError } = await getFlowMetrics();
      if (metricsError) {
        setError(metricsError);
        setLoading(false);
        return;
      }

      // Fetch tasks for detailed display
      const { tasks: apiTasks, error: tasksError } = await getTasks();
      if (tasksError) {
        setError(tasksError);
      }

      // Transform metrics to UI data
      if (metrics.sprint) {
        setSprint(metrics.sprint);
      }

      // Build signals from alerts
      const newSignals: SignalData[] = [];
      
      // People signal: overloaded workers
      const overloadedCount = metrics.workers.filter(w => w.status === 'overloaded').length;
      if (overloadedCount > 0) {
        const overloadedNames = metrics.workers
          .filter(w => w.status === 'overloaded')
          .map(w => w.display_name)
          .join(', ');
        newSignals.push({
          id: 'people',
          label: 'Люди',
          count: overloadedCount,
          description: overloadedNames,
        });
      } else {
        newSignals.push({ id: 'people', label: 'Люди', count: 0, description: 'Все в норме' });
      }

      // Processes signal: bottleneck columns
      const bottleneckCount = metrics.columns.filter(c => c.health === 'red').length;
      const stuckCount = 0; // TODO: from stuck_tasks view
      if (bottleneckCount + stuckCount > 0) {
        newSignals.push({
          id: 'processes',
          label: 'Процессы',
          count: bottleneckCount + stuckCount,
          description: `Ревью ${bottleneckCount}, Блокеры ${stuckCount}`,
        });
      } else {
        newSignals.push({ id: 'processes', label: 'Процессы', count: 0, description: 'Нет проблем' });
      }

      // Escalations signal
      const escalationCount = metrics.alerts.filter(a => a.type === 'overloaded_member').length;
      if (escalationCount > 0) {
        newSignals.push({
          id: 'escalations',
          label: 'Эскалации',
          count: escalationCount,
          description: 'Нужен менеджер',
        });
      } else {
        newSignals.push({ id: 'escalations', label: 'Эскалации', count: 0, description: 'Нет эскалаций' });
      }
      setSignals(newSignals);

      // Build task status cards
      const backlogCount = metrics.columns.find(c => c.name === 'backlog')?.wip_current ?? 0;
      const inProgressCount = metrics.columns.find(c => c.name === 'in_progress')?.wip_current ?? 0;
      const reviewCount = metrics.columns.find(c => c.name === 'review')?.wip_current ?? 0;
      const doneCount = metrics.columns.find(c => c.name === 'done')?.wip_current ?? 0;

      setTaskStatuses([
        {
          id: 'active',
          label: 'Активные',
          count: inProgressCount,
          shapes: Math.min(inProgressCount, 10),
          maxShapes: 10,
          color: 'var(--color-accent-amber)',
        },
        {
          id: 'queue',
          label: 'В очереди',
          count: backlogCount,
          shapes: Math.min(backlogCount, 10),
          maxShapes: 10,
          color: 'var(--color-text-primary)',
        },
        {
          id: 'review',
          label: 'На проверке',
          count: reviewCount,
          shapes: Math.min(reviewCount, 10),
          maxShapes: 10,
          color: 'var(--color-signal-cyan)',
        },
        {
          id: 'done',
          label: 'Сделано',
          count: doneCount,
          shapes: Math.min(doneCount, 10),
          maxShapes: 10,
          color: 'var(--color-signal-green)',
        },
      ]);

      // Build worker/agent cards
      const newWorkers: WorkerCardData[] = [];
      const newAgents: AgentCardData[] = [];

      for (const wm of metrics.workers) {
        const workerTasks = allTasks.filter(t => t.assigned_to === wm.display_name);
        const card = {
          id: wm.display_name,
          cognitiveWeight: wm.cognitive_load,
          spPerDay: wm.type === 'human' ? 3.5 : 5.0,
          trendUp: true,
          activeDays: 5,
          roleLabel: wm.type === 'human' ? 'Участник команды' : 'AI-агент',
          overloaded: wm.status === 'overloaded',
          tasks: tasksToWorkerTaskList(workerTasks),
          type: wm.type,
        };

        if (wm.type === 'human') {
          newWorkers.push({ ...card, displayName: wm.display_name } as WorkerCardData);
        } else {
          newAgents.push({ ...card, name: wm.display_name } as AgentCardData);
        }
      }

      setWorkers(newWorkers);
      setAgents(newAgents);
      setAllTasks((apiTasks ?? []) as unknown as TasksRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, allTasks]);

  // Initial fetch
  useEffect(() => {
    if (workspaceId) {
      fetchData();
    }
  }, [workspaceId, fetchData]);

  // Realtime subscription
  useTasksRealtime(workspaceId, useCallback((event) => {
    // Invalidate and refetch on any task change
    fetchData();
  }, [fetchData]));

  // Flow metrics invalidation
  // (would use useFlowMetricsRealtime here when broadcast events are implemented)

  const currentDate = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <FlowBoard
      title="Флоу задач"
      currentDate={currentDate.charAt(0).toUpperCase() + currentDate.slice(1)}
      sprint={sprint}
      signals={signals}
      taskStatuses={taskStatuses}
      workers={workers}
      agents={agents}
      loading={loading}
      error={error}
      onAddWorker={() => console.log('Add worker clicked')}
      onAddAgent={() => console.log('Add agent clicked')}
      onRefresh={fetchData}
    />
  );
}