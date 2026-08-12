'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from '../../types/supabase';
import type { TaskEntity } from '@/types/flowboard';
import { getClient } from '@/lib/supabase/client';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { buildFullId } from '@/lib/realtime/tasks';

/**
 * Defensive helper: гарантирует наличие full_id/workspace_prefix в TaskEntity.
 * Сервер — источник правды, но если какой-либо endpoint вернёт задачу без
 * этих полей (баг, будущий роут), клиент не упадёт — вычисляем fallback.
 */
function ensureFullId(task: TaskEntity, fallbackPrefix?: string): TaskEntity {
  // Guard: если payload не объект или нет id — возвращаем как есть,
  // чтобы не упасть на buildFullId(prefix, task_number, undefined).slice()
  if (!task || typeof task !== 'object' || !task.id) return task;
  if (task.full_id && task.workspace_prefix) return task;
  const prefix = task.workspace_prefix || fallbackPrefix || 'TASK';
  const fullId = task.full_id || buildFullId(prefix, task.task_number, task.id);
  return { ...task, full_id: fullId, workspace_prefix: prefix };
}

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
    status?: string;
    /** Number of completed tasks in this sprint */
    doneTasks?: number;
    /** Total number of tasks in this sprint */
    totalTasks?: number;
  } | null;
  columns: Array<{
    name: string;
    wip_current: number;
    wip_limit?: number | null;
    health: 'green' | 'yellow' | 'red';
  }>;
  workers: Array<{
    id: string;
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
  /** Whether boards data has been loaded at least once (for dedup guard) */
  _boardsLoaded: boolean;
  /** Whether the very first load from server has completed */
  _firstLoadDone: boolean;
}

type Action =
  | { type: 'SET_TASKS'; payload: TaskEntity[] }
  | { type: 'PATCH_TASK'; payload: TaskEntity }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'SET_METRICS'; payload: FlowMetrics | null }
  | { type: 'PATCH_METRICS'; payload: Partial<FlowMetrics> }
  | { type: 'SET_WORKSPACES'; payload: Workspace[] }
  | { type: 'SET_WORKERS'; payload: Worker[] }
  | { type: 'SET_ACTIVE_WORKSPACE'; payload: string | null }
  | { type: 'SET_BOARDS'; payload: Omit<DataStore['boards'], 'lastUpdated'> }
  | { type: 'SET_BOARDS_LOADED'; payload: true }
  | { type: 'SET_FIRST_LOAD_DONE'; payload: true }
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
  _boardsLoaded: false,
  _firstLoadDone: false,
};

function dataReducer(state: DataStore, action: Action): DataStore {
  switch (action.type) {
    case 'SET_TASKS':
      return {
        ...state,
        tasks: {
          items: action.payload.filter((t) => t && t.id).map((t) => ensureFullId(t)),
          lastUpdated: Date.now(),
        },
      };

    case 'PATCH_TASK': {
      // Guard: невалидный payload (undefined/null/без id) не должен ронять reducer
      if (!action.payload || typeof action.payload !== 'object' || !action.payload.id) return state;
      const safeTask = ensureFullId(action.payload);
      const idx = state.tasks.items.findIndex(t => t.id === safeTask.id);
      if (idx === -1) {
        return {
          ...state,
          tasks: {
            items: [...state.tasks.items, safeTask],
            lastUpdated: Date.now(),
          },
        };
      }
      const next = [...state.tasks.items];
      next[idx] = safeTask;
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

    case 'PATCH_METRICS': {
      const current = state.metrics.data;
      if (!current) return state;
      return {
        ...state,
        metrics: {
          data: { ...current, ...action.payload },
          lastUpdated: Date.now(),
        },
      };
    }

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

    case 'SET_BOARDS_LOADED':
      return { ...state, _boardsLoaded: true };

    case 'SET_FIRST_LOAD_DONE':
      return { ...state, _firstLoadDone: true };

    case 'CLEAR_ALL':
      return { ...initialState, _boardsLoaded: state._boardsLoaded, _firstLoadDone: state._firstLoadDone };

    default:
      return state;
  }
}

interface DataContextValue {
  state: DataStore;
  dispatch: React.Dispatch<Action>;
  loadBoardsData: (workspaceId?: string, options?: { partial?: boolean }) => Promise<void>;
  /** Set the active workspace — persists to server and reloads flow data */
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  /** Whether auth data is available from useAuth */
  authData: import('../../types/api').InitResponse | null;
  isLoadingAuth: boolean;
  /** Whether the very first server load has completed */
  firstLoadDone: boolean;
  /** Error message if data loading failed, null otherwise */
  dataError: string | null;
  /** Whether the user is currently switching workspaces (for loading states) */
  isSwitchingWorkspace: boolean;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, initialState);
  const { data: authData, isLoading: isLoadingAuth, initData } = useTelegramAuth();

  // Ref to track if initial load happened (dedup guard)
  const boardsLoadedRef = useRef(false);

  // Ref for initData (avoids stale closure in loadBoardsData callback)
  const initDataRef = useRef('');
  useEffect(() => {
    initDataRef.current = initData;
  }, [initData]);

  // Ref to track which workspace was used in the parallel load (for comparison when authData arrives)
  const firstLoadedWorkspaceIdRef = useRef<string | null>(null);

  // State for data loading error and workspace switching
  const [dataError, setDataError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const loadBoardsData = useCallback(async (workspaceId?: string, options?: { partial?: boolean }) => {
    // Guard: require initData before making any API call (fixes race condition #2)
    const currentInitData = initDataRef.current;
    if (!currentInitData) {
      console.warn('[DataContext] loadBoardsData called before initData is available');
      return;
    }

    const isPartial = options?.partial ?? false;

    // Timeout protection — abort after 10 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch('/api/workspaces/my-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: currentInitData,
          ...(workspaceId && { workspace_id: workspaceId }),
          ...(isPartial && { partial: true }),
        }),
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

      const { workers: workersData, allWorkspaceWorkers: allWorkersData, workspaces: wsData, tasks, metrics } = json.data;

      // Track which workspace was used for this load (for parallel load comparison)
      if (!workspaceId && wsData?.length > 0) {
        firstLoadedWorkspaceIdRef.current = wsData[0].id;
      } else if (workspaceId) {
        firstLoadedWorkspaceIdRef.current = workspaceId;
      }

      // Map full task rows to TaskEntity
      const tasksList = tasks ?? [];
      const wsById = new Map<string, string>((wsData ?? []).map((w: any) => [w.id, w.task_prefix ?? 'TASK']));
      const taskEntities: TaskEntity[] = tasksList.map((task: any) => {
        const prefix = wsById.get(task.workspace_id) ?? 'TASK';
        const fullId = prefix && task.task_number ? `${prefix}-${task.task_number}` : task.id.slice(0, 8);
        return {
          ...task,
          full_id: fullId,
          workspace_prefix: prefix,
          ai_hint: null,
          story_points: null,
        } as TaskEntity;
      });

      // Partial load: update workers (for FlowBoard colleagues) + tasks + metrics
      // Full load: update workspaces + tasks + metrics (for /boards page)
      if (isPartial) {
        // For partial loads, use allWorkspaceWorkers so FlowBoard shows ALL colleagues
        // This ensures new invitees appear without full reload
        dispatch({ type: 'SET_WORKERS', payload: allWorkersData ?? workersData ?? [] });
      } else {
        dispatch({ type: 'SET_WORKERS', payload: workersData ?? [] });
        dispatch({ type: 'SET_WORKSPACES', payload: wsData ?? [] });
      }

      dispatch({ type: 'SET_TASKS', payload: taskEntities });

      // Dispatch metrics if present (consolidated endpoint)
      if (metrics) {
        dispatch({ type: 'SET_METRICS', payload: metrics });
      }

      // Only compute + dispatch board cards on full load (not partial)
      if (!isPartial) {
        // Resolve variables needed in the card mapping closure
        const allWorkspaceWorkers = allWorkersData ?? [];
        const metricsWorkspaceId = (wsData?.[0]?.id as string | undefined) ?? null;

        // Compute boards risk data
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

          // Use allWorkspaceWorkers for accurate member counts across the entire workspace
          const wsAllWorkers = allWorkspaceWorkers.filter((w: any) => w.workspace_id === ws.id);

          // Attach sprint data if this is the active workspace and metrics contain a sprint
          const cardSprint = (ws.id === metricsWorkspaceId && metrics?.sprint)
            ? {
                name: metrics.sprint.name,
                topic: metrics.sprint.topic,
                daysElapsed: metrics.sprint.daysElapsed,
                totalDays: metrics.sprint.totalDays,
              }
            : undefined;

          return {
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
            memberCount: wsAllWorkers.filter((w: any) => w.type === 'human').length,
            agentCount: wsAllWorkers.filter((w: any) => w.type === 'agent').length,
            stats: {
              inQueue: wsTasks.filter((t: any) => t.column === 'backlog').length,
              inWork: wsTasks.filter((t: any) => t.column === 'in_progress').length,
              onReview: wsTasks.filter((t: any) => t.column === 'review').length,
              done: wsTasks.filter((t: any) => t.column === 'done').length,
            },
            sprint: cardSprint,
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
      }

      // Mark as loaded + clear any previous error
      dispatch({ type: 'SET_BOARDS_LOADED', payload: true });
      dispatch({ type: 'SET_FIRST_LOAD_DONE', payload: true });
      boardsLoadedRef.current = true;
      setDataError(null);
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : 'failed_to_load_boards_data';
      console.error('[DataContext] failed to load boards data:', err);
      setDataError(message);
    }
  }, []);

  // Parallel load (Option A): start loadBoardsData as soon as initData is available,
  // without waiting for /api/init to complete. Server uses first workspace.
  // When authData arrives, if active workspace differs, reload with correct workspaceId.
  useEffect(() => {
    if (!initData) return;
    if (boardsLoadedRef.current) return;
    if (authData?.worker) return; // Auth already arrived — let the auth effect handle it
    loadBoardsData();
  }, [initData, authData?.worker, loadBoardsData]);

  // Sync workspace and worker data from auth response + load boards data
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
    const targetWorkspaceId = activeWsId || authData.worker.workspace_id;

    if (targetWorkspaceId) {
      dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: targetWorkspaceId });

      // If parallel load already completed, check if we need to reload for correct workspace.
      // The parallel load (above effect) uses the first workspace; if the active workspace
      // differs, reload to get correct metrics.
      if (!boardsLoadedRef.current) {
        loadBoardsData(targetWorkspaceId);
      } else {
        // Data already loaded by parallel effect — check if workspace matches
        const loadedWorkspaceId = firstLoadedWorkspaceIdRef.current;
        if (loadedWorkspaceId && targetWorkspaceId !== loadedWorkspaceId) {
          // Clear stale metrics from parallel load (wrong workspace) + show loading state
          // This prevents flash of board A's data when user's active board is B
          dispatch({ type: 'SET_METRICS', payload: null });
          setIsSwitchingWorkspace(true);
          loadBoardsData(targetWorkspaceId).finally(() => setIsSwitchingWorkspace(false));
        }
      }
    }
  }, [authData?.worker?.id, authData?.workspaces, loadBoardsData]);

  /** Set the active workspace — persists to server and reloads flow data */
  const setActiveWorkspace = useCallback(async (workspaceId: string) => {
    // Guard: require initData before making any API call
    const currentInitData = initDataRef.current;
    if (!currentInitData) {
      console.warn('[DataContext] setActiveWorkspace called before initData is available');
      return;
    }

    // Optimistic update
    dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: workspaceId });

    // Reset stale metrics immediately so FlowBoard shows loading state
    dispatch({ type: 'SET_METRICS', payload: null });

    // Show loading state during switch (fixes flash of empty content #4)
    setIsSwitchingWorkspace(true);

    // Persist to server (fire and forget — don't block UI on this)
    // The server save is non-critical for the UI; if it fails, the next load
    // will just use the previous workspace. This saves 1 HTTP RTT on board switch.
    fetch('/api/workspaces/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: currentInitData, workspace_id: workspaceId }),
    }).catch((err) => console.error('[DataContext] Failed to save active workspace:', err));

    // Reload data with partial load (only tasks + metrics for this workspace)
    // This skips fetching all workspaces + board cards, reducing response size
    try {
      await loadBoardsData(workspaceId, { partial: true });
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }, [loadBoardsData]);

  // Subscribe to realtime task changes
  // Use refs to avoid recreating the channel on every render
  const workspacesRef = useRef(state.workspaces.items);
  useEffect(() => {
    workspacesRef.current = state.workspaces.items;
  }, [state.workspaces.items]);

  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;

    // Resolve prefix once — prefer stored workspaces, fallback to 'TASK'
    const getPrefix = (wsId: string) => {
      const items = workspacesRef.current;
      const ws = items.find(w => w.id === wsId);
      return ws?.task_prefix ?? 'TASK';
    };

    const prefix = getPrefix(workspaceId);

    const supabase = getClient();

    // Realtime callback — plain function (no useRef inside useEffect, which
    // violates Rules of Hooks and crashes at runtime).
    const handleRealtime = (payload: { eventType: string; new: TasksRow | null; old: TasksRow | null }) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const raw = payload.new as TasksRow | null;
        if (!raw) return;
        // Use shared buildFullId for consistency with API and useTasksRealtime
        const fullId = buildFullId(prefix, raw.task_number, raw.id);
        const taskEntity: TaskEntity = {
          ...raw,
          full_id: fullId,
          workspace_prefix: prefix,
          ai_hint: null,
          story_points: null,
        } as TaskEntity;
        dispatch({ type: 'PATCH_TASK', payload: taskEntity });
      } else if (payload.eventType === 'DELETE') {
        const oldTask = payload.old as TasksRow;
        if (!oldTask) return;
        // For DELETE, try to resolve prefix from old task's workspace_id
        const oldPrefix = getPrefix(oldTask.workspace_id);
        const fullId = buildFullId(oldPrefix, oldTask.task_number, oldTask.id);
        // Remove by UUID (primary key) — this is the correct identifier
        dispatch({ type: 'REMOVE_TASK', payload: oldTask.id });
        // Log for debugging: show the full_id that was removed
        console.debug('[DataContext] REMOVE_TASK:', oldTask.id, '(full_id:', fullId, ')');
      }
    };

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
        handleRealtime,
      )
      .subscribe({
        status: 'SUBSCRIBED',
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (err) {
        // Realtime cleanup не должен ронять UI при размонтировании
        console.warn('[DataContext] Failed to remove realtime channel:', err);
      }
    };
  }, [state.activeWorkspaceId]);

  // Load boards data when active workspace changes (e.g., user selects different board)
  // Initial load is handled in the auth useEffect above or by the parallel load effect.
  // Skip the first change (from null to value) — it's handled by auth/parallel effects.
  // Only reload when the user explicitly switches workspaces (from one value to another).
  const prevActiveWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    const prevWorkspaceId = prevActiveWorkspaceIdRef.current;
    // Update ref regardless of whether we reload
    prevActiveWorkspaceIdRef.current = workspaceId;

    if (workspaceId && boardsLoadedRef.current) {
      // Skip initial set (from null to value) — already handled by auth/parallel effects
      if (prevWorkspaceId !== null && prevWorkspaceId !== workspaceId) {
        loadBoardsData(workspaceId, { partial: true });
      }
    }
  }, [state.activeWorkspaceId, loadBoardsData]);

  return (
    <DataContext.Provider value={{
      state,
      dispatch,
      loadBoardsData,
      setActiveWorkspace,
      authData,
      isLoadingAuth,
      firstLoadDone: state._firstLoadDone,
      dataError,
      isSwitchingWorkspace,
    }}>
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