'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect, useState } from 'react';
import type { Database } from '../../types/supabase';
import type { TaskEntity } from '@/types/flowboard';
import { getClient } from '@/lib/supabase/client';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Worker = Database['public']['Tables']['workers']['Row'];

export interface FlowMetrics {
  sprintEnabled: boolean;
  sprint: {
    id: string;
    name: string;
    topic: string;
    startDate: string;
    endDate: string;
    daysElapsed: number;
    totalDays: number;
    progress: number;
    doneSP: number;
    totalSP: number;
    inProgress: number;
    onReview: number;
    isActive: boolean;
  } | null;
  columns: Array<{
    name: string;
    wip_current: number;
    wip_limit?: number | null;
    health: 'green' | 'yellow' | 'red';
  }>;
  workers: Array<{
    display_name: string;
    type: 'human' | 'agent';
    status: 'ok' | 'overloaded';
    cognitive_load: number;
  }>;
  alerts: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
}

interface DataStore {
  tasks: {
    items: TaskEntity[];
    lastUpdated: number | null;
  };
  metrics: {
    data: FlowMetrics | null;
    lastUpdated: number | null;
  };
  workspaces: {
    items: Workspace[];
    lastUpdated: number | null;
  };
  workers: {
    items: Worker[];
    lastUpdated: number | null;
  };
  /** UUID of the user's currently selected workspace/board (from profiles.last_active_workspace_id) */
  activeWorkspaceId: string | null;
  boards: {
    riskData: {
      people: number;
      processes: number;
      escalations: number;
    } | null;
    cards: Array<{
      id: string;
      name: string;
      slug: string;
      memberCount: number;
      agentCount: number;
      stats: {
        inQueue: number;
        inWork: number;
        onReview: number;
        done: number;
      };
      sprint?: any;
    }>;
    lastUpdated: number | null;
  };
}

type Action =
  | { type: 'SET_TASKS'; payload: TaskEntity[] }
  | { type: 'PATCH_TASK'; payload: TaskEntity }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'SET_METRICS'; payload: FlowMetrics }
  | { type: 'SET_WORKSPACES'; payload: Workspace[] }
  | { type: 'SET_WORKERS'; payload: Worker[] }
  | { type: 'SET_ACTIVE_WORKSPACE'; payload: string | null }
  | { type: 'SET_BOARDS'; payload: Omit<DataStore['boards'], 'lastUpdated'> }
  | { type: 'CLEAR_ALL'; payload: null };

const initialState: DataStore = {
  tasks: {
    items: [],
    lastUpdated: null,
  },
  metrics: {
    data: null,
    lastUpdated: null,
  },
  workspaces: {
    items: [],
    lastUpdated: null,
  },
  workers: {
    items: [],
    lastUpdated: null,
  },
  activeWorkspaceId: null,
  boards: {
    riskData: null,
    cards: [],
    lastUpdated: null,
  },
};

function dataReducer(state: DataStore, action: Action): DataStore {
  switch (action.type) {
    case 'SET_TASKS':
      return {
        ...state,
        tasks: {
          items: action.payload,
          lastUpdated: Date.now(),
        },
      };

    case 'PATCH_TASK': {
      const idx = state.tasks.items.findIndex(t => t.id === action.payload.id);
      if (idx === -1) {
        return {
          ...state,
          tasks: {
            items: [...state.tasks.items, action.payload],
            lastUpdated: Date.now(),
          },
        };
      }
      const next = [...state.tasks.items];
      next[idx] = action.payload;
      return {
        ...state,
        tasks: {
          items: next,
          lastUpdated: Date.now(),
        },
      };
    }

    case 'REMOVE_TASK':
      return {
        ...state,
        tasks: {
          items: state.tasks.items.filter(t => t.id !== action.payload),
          lastUpdated: Date.now(),
        },
      };

    case 'SET_METRICS':
      return {
        ...state,
        metrics: {
          data: action.payload,
          lastUpdated: Date.now(),
        },
      };

    case 'SET_WORKSPACES':
      return {
        ...state,
        workspaces: {
          items: action.payload,
          lastUpdated: Date.now(),
        },
      };

    case 'SET_WORKERS':
      return {
        ...state,
        workers: {
          items: action.payload,
          lastUpdated: Date.now(),
        },
      };

    case 'SET_ACTIVE_WORKSPACE':
      return {
        ...state,
        activeWorkspaceId: action.payload,
      };

    case 'SET_BOARDS':
      return {
        ...state,
        boards: {
          ...action.payload,
          lastUpdated: Date.now(),
        },
      };

    case 'CLEAR_ALL':
      return initialState;

    default:
      return state;
  }
}

interface DataContextValue {
  state: DataStore;
  dispatch: React.Dispatch<Action>;
  loadBoardsData: () => Promise<void>;
  /** Set the active workspace — persists to server and reloads flow data */
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  /** Whether auth data is available from useAuth */
  authData: import('../../types/api').InitResponse | null;
  isLoadingAuth: boolean;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, initialState);
  const { data: authData, isLoading: isLoadingAuth } = useTelegramAuth();

  // Sync workspace and worker data from auth response
  useEffect(() => {
    if (!authData?.worker) return;

    const worker: Worker = {
      id: authData.worker.id,
      workspace_id: authData.worker.workspace_id,
      source_id: '',
      type: 'human',
      role: authData.worker.role,
      display_name: authData.worker.display_name,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    dispatch({ type: 'SET_WORKERS', payload: [worker] });

    // Sync all workspaces from auth response
    if (authData.workspaces.length > 0) {
      const now = new Date().toISOString();
      const workspaces: Workspace[] = authData.workspaces.map((ws: any) => ({
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        task_prefix: ws.task_prefix,
        owner_id: '',
        plan: 'free',
        story_points_enabled: false,
        cognitive_budget_enabled: false,
        telegram_chat_id: null,
        linked_at: null,
        created_at: now,
        updated_at: now,
      }));
      dispatch({ type: 'SET_WORKSPACES', payload: workspaces });
    }

    // Initialize activeWorkspaceId from authData (comes from profiles.last_active_workspace_id)
    const activeWsId = (authData as any).last_active_workspace_id ?? null;
    if (activeWsId) {
      dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: activeWsId });
    } else if (authData.worker.workspace_id) {
      // Fallback: use primary workspace if no saved active board
      dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: authData.worker.workspace_id });
    }
  }, [authData?.worker?.id, authData?.workspaces]);

  const loadBoardsData = useCallback(async () => {
    // Timeout protection — abort after 10 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
      const telegramWebApp = globalWindow?.Telegram?.WebApp;
      const initData = telegramWebApp?.initData || '';

      const res = await fetch('/api/workspaces/my-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || 'Failed to load board data');
      }

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Failed to load board data');
      }

      const { workers: workersData, workspaces: wsData, tasks } = json.data;

      dispatch({ type: 'SET_WORKERS', payload: workersData ?? [] });
      dispatch({ type: 'SET_WORKSPACES', payload: wsData ?? [] });

      const tasksList = tasks ?? [];
      const peopleSet = new Set<string>();
      let processCount = 0;
      let escalationCount = 0;

      tasksList.forEach((task: any) => {
        if (task.assigned_to) {
          peopleSet.add(task.assigned_to);
        }
        if (task.column === 'in_progress') {
          processCount++;
        }
        if (task.escalation_reason) {
          escalationCount++;
        }
      });

      const cards = (wsData ?? []).map((ws: any) => {
        const wsTasks = tasksList.filter((t: any) => t.workspace_id === ws.id);

        return {
          id: ws.id,
          name: ws.name,
          slug: ws.slug,
          memberCount: (workersData ?? []).filter((w: any) => w.workspace_id === ws.id && w.type === 'human').length,
          agentCount: (workersData ?? []).filter((w: any) => w.workspace_id === ws.id && w.type === 'agent').length,
          stats: {
            inQueue: wsTasks.filter((t: any) => t.column === 'backlog').length,
            inWork: wsTasks.filter((t: any) => t.column === 'in_progress').length,
            onReview: wsTasks.filter((t: any) => t.column === 'review').length,
            done: wsTasks.filter((t: any) => t.column === 'done').length,
          },
          sprint: undefined,
        };
      });

      dispatch({
        type: 'SET_BOARDS',
        payload: {
          riskData: {
            people: peopleSet.size,
            processes: processCount,
            escalations: escalationCount,
          },
          cards,
        },
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('[DataContext] failed to load boards data:', err);
    }
  }, []);

  /** Set the active workspace — persists to server and reloads flow data */
  const setActiveWorkspace = useCallback(async (workspaceId: string) => {
    // Optimistic update
    dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: workspaceId });

    // Persist to server (migration 016: profiles.last_active_workspace_id)
    try {
      const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
      const telegramWebApp = globalWindow?.Telegram?.WebApp;
      const initData = telegramWebApp?.initData || '';

      await fetch('/api/workspaces/active-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData, workspace_id: workspaceId }),
      });
    } catch (err) {
      console.error('[DataContext] Failed to save active workspace:', err);
    }

    // Reload boards data for the new workspace
    await loadBoardsData();

    // Reload flow metrics for the new workspace
    try {
      const { getFlowMetrics } = await import('@/lib/api/flow');
      const { metrics, error: metricsError } = await getFlowMetrics(workspaceId);
      if (metricsError) {
        console.error('[DataContext] Failed to load flow metrics:', metricsError);
        return;
      }
      dispatch({ type: 'SET_METRICS', payload: metrics });
    } catch (err) {
      console.error('[DataContext] Load metrics error:', err);
    }
  }, [loadBoardsData]);

  // Subscribe to realtime task changes
  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;

    const supabase = getClient();
    const channel = supabase
      .channel(`global-tasks-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload: { eventType: string; new: TasksRow | null; old: TasksRow | null }) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const raw = payload.new as TasksRow | null;
            if (!raw) return;
            const fullId = raw.task_number ? `TASK-${raw.task_number}` : raw.id.slice(0, 8);
            const taskEntity: TaskEntity = {
              ...raw,
              full_id: fullId,
              workspace_prefix: 'TASK',
              ai_hint: null,
              story_points: null,
            } as TaskEntity;
            dispatch({ type: 'PATCH_TASK', payload: taskEntity });
          } else if (payload.eventType === 'DELETE') {
            dispatch({ type: 'REMOVE_TASK', payload: (payload.old as TasksRow).id });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [state.activeWorkspaceId]);

  // Load boards data when active workspace is available
  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    if (workspaceId) {
      loadBoardsData();
    }
  }, [state.activeWorkspaceId, loadBoardsData]);

  // Load flow metrics when active workspace changes
  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;

    let cancelled = false;

    async function loadMetrics() {
      try {
        const { getFlowMetrics } = await import('@/lib/api/flow');
        const { metrics, error: metricsError } = await getFlowMetrics(workspaceId as string);
        if (cancelled) return;
        if (metricsError) {
          console.error('[DataContext] Failed to load flow metrics:', metricsError);
          return;
        }
        dispatch({ type: 'SET_METRICS', payload: metrics });
      } catch (err) {
        if (!cancelled) console.error('[DataContext] Load metrics error:', err);
      }
    }

    loadMetrics();
    return () => { cancelled = true; };
  }, [state.activeWorkspaceId]);

  // Load tasks when active workspace is available
  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;

    let cancelled = false;

    async function loadTasks() {
      try {
        const flowApi = await import('@/lib/api/flow');
        const result = await flowApi.getTasks();
        if (cancelled) return;
        if (result.error) {
          console.error('[DataContext] Failed to load tasks:', result.error);
          return;
        }
        const tasks: TaskEntity[] = result.tasks.map((task: any) => {
          const fullId = task.task_number ? `TASK-${task.task_number}` : task.id.slice(0, 8);
          return {
            ...task,
            full_id: fullId,
            workspace_prefix: 'TASK',
            ai_hint: null,
            story_points: null,
          } as TaskEntity;
        });
        dispatch({ type: 'SET_TASKS', payload: tasks });
      } catch (err) {
        if (!cancelled) console.error('[DataContext] Load tasks error:', err);
      }
    }

    loadTasks();
    return () => { cancelled = true; };
  }, [state.activeWorkspaceId]);

  return (
    <DataContext.Provider value={{ state, dispatch, loadBoardsData, setActiveWorkspace, authData, isLoadingAuth }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used within DataProvider');
  }
  return ctx;
}