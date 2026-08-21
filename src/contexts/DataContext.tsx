'use client';

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Database } from '../../types/supabase';
import type { TaskEntity } from '@/types/flowboard';
import { getClient } from '@/lib/supabase/client';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { buildFullId } from '@/lib/realtime/tasks';

/**
 * Defensive helper: гарантирует наличие full_id/workspace_prefix в TaskEntity.
 * Сервер — источник правды, но если какой-либо endpoint вернёт задачу без
 * этих полей, клиент не упадёт — вычисляем fallback через buildFullId.
 */
function ensureFullId(task: TaskEntity, fallbackPrefix?: string): TaskEntity {
  if (!task || typeof task !== 'object' || !task.id) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[DataContext] ensureFullId: task without id received:', {
        task,
        fallbackPrefix,
        keys: task && typeof task === 'object' ? Object.keys(task) : undefined,
        stack: new Error('ensureFullId guard').stack,
      });
    }
    return task;
  }
  if (task.full_id && task.workspace_prefix) return task;
  const prefix = task.workspace_prefix || fallbackPrefix || 'TASK';
  const fullId = task.full_id || buildFullId(prefix, task.task_number, task.id);
  return { ...task, full_id: fullId, workspace_prefix: prefix };
}

/** Map raw API / DB task row → TaskEntity (единый путь для load + realtime). */
function toTaskEntity(
  raw: Record<string, unknown> & { id: string; task_number?: number | null; workspace_id?: string },
  prefix: string,
): TaskEntity {
  const fullId = buildFullId(prefix, raw.task_number as number | null | undefined, raw.id);
  return {
    ...raw,
    full_id: fullId,
    workspace_prefix: prefix,
    ai_hint: (raw as any).ai_hint ?? null,
    story_points: (raw as any).story_points ?? null,
  } as TaskEntity;
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
    doneTasks?: number;
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
  /** UUID of the user's currently selected workspace/board */
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
      sprint?: {
        name: string;
        topic: string;
        daysElapsed: number;
        totalDays: number;
      };
    }>;
    lastUpdated: number | null;
  };
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
  | { type: 'REMOVE_WORKSPACE'; payload: string }
  | { type: 'SET_WORKERS'; payload: Worker[] }
  | { type: 'SET_ACTIVE_WORKSPACE'; payload: string | null }
  | { type: 'SET_BOARDS'; payload: Omit<DataStore['boards'], 'lastUpdated'> }
  | { type: 'SET_FIRST_LOAD_DONE'; payload: true }
  | { type: 'CLEAR_ALL'; payload: null };

const initialState: DataStore = {
  tasks: { items: [], lastUpdated: null },
  metrics: { data: null, lastUpdated: null },
  workspaces: { items: [], lastUpdated: null },
  workers: { items: [], lastUpdated: null },
  activeWorkspaceId: null,
  boards: { riskData: null, cards: [], lastUpdated: null },
  _firstLoadDone: false,
};

function dataReducer(state: DataStore, action: Action): DataStore {
  switch (action.type) {
    case 'SET_TASKS': {
      const invalid = action.payload.filter((t) => !t || !t.id);
      if (invalid.length > 0 && process.env.NODE_ENV === 'development') {
        console.error('[DataContext] SET_TASKS: ignored tasks without id:', {
          count: invalid.length,
          sample: invalid.slice(0, 3),
          stack: new Error('SET_TASKS guard').stack,
        });
      }
      return {
        ...state,
        tasks: {
          items: action.payload.filter((t) => t && t.id).map((t) => ensureFullId(t)),
          lastUpdated: Date.now(),
        },
      };
    }
    case 'PATCH_TASK': {
      if (!action.payload || typeof action.payload !== 'object' || !action.payload.id) {
        if (process.env.NODE_ENV === 'development') {
          let serialized = 'N/A';
          try {
            serialized = JSON.stringify(action.payload);
          } catch (e) {
            serialized = `[unserializable: ${e instanceof Error ? e.message : String(e)}]`;
          }
          console.error('[DataContext] PATCH_TASK: ignored invalid payload:', {
            payload: action.payload,
            serialized,
            keys:
              action.payload && typeof action.payload === 'object'
                ? Object.keys(action.payload)
                : undefined,
            stack: new Error('PATCH_TASK guard').stack,
          });
        }
        return state;
      }
      const safeTask = ensureFullId(action.payload);
      const idx = state.tasks.items.findIndex((t) => t.id === safeTask.id);
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
        tasks: { items: next, lastUpdated: Date.now() },
      };
    }
    case 'REMOVE_TASK':
      return {
        ...state,
        tasks: {
          items: state.tasks.items.filter((t) => t.id !== action.payload),
          lastUpdated: Date.now(),
        },
      };
    case 'SET_METRICS':
      return {
        ...state,
        metrics: { data: action.payload, lastUpdated: Date.now() },
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
        workspaces: { items: action.payload, lastUpdated: Date.now() },
      };
    case 'REMOVE_WORKSPACE':
      return {
        ...state,
        workspaces: {
          items: state.workspaces.items.filter((w) => w.id !== action.payload),
          lastUpdated: Date.now(),
        },
        boards: {
          ...state.boards,
          cards: state.boards.cards.filter((c) => c.id !== action.payload),
          lastUpdated: Date.now(),
        },
      };
    case 'SET_WORKERS':
      return {
        ...state,
        workers: { items: action.payload, lastUpdated: Date.now() },
      };
    case 'SET_ACTIVE_WORKSPACE':
      return { ...state, activeWorkspaceId: action.payload };
    case 'SET_BOARDS': {
      // Не затираем sprint у карточки, если новый payload его не принёс
      const prevById = new Map(state.boards.cards.map((c) => [c.id, c]));
      const cards = action.payload.cards.map((card) => {
        if (card.sprint != null) return card;
        const prev = prevById.get(card.id);
        if (prev?.sprint != null) return { ...card, sprint: prev.sprint };
        return card;
      });
      return {
        ...state,
        boards: {
          ...action.payload,
          cards,
          lastUpdated: Date.now(),
        },
      };
    }
    case 'SET_FIRST_LOAD_DONE':
      return { ...state, _firstLoadDone: true };
    case 'CLEAR_ALL':
      return { ...initialState, _firstLoadDone: state._firstLoadDone };
    default:
      return state;
  }
}

interface DataContextValue {
  state: DataStore;
  dispatch: React.Dispatch<Action>;
  loadBoardsData: (workspaceId?: string, options?: { partial?: boolean }) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  authData: import('../../types/api').InitResponse | null;
  isLoadingAuth: boolean;
  firstLoadDone: boolean;
  dataError: string | null;
  isSwitchingWorkspace: boolean;
  removeWorkspace: (workspaceId: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, initialState);
  const { data: authData, isLoading: isLoadingAuth, initData } = useTelegramAuth();

  const initDataRef = useRef('');
  useEffect(() => {
    initDataRef.current = initData;
  }, [initData]);

  const activeWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeWorkspaceIdRef.current = state.activeWorkspaceId;
  }, [state.activeWorkspaceId]);

  const [dataError, setDataError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const loadBoardsData = useCallback(
    async (workspaceId?: string, options?: { partial?: boolean }) => {
      const currentInitData = initDataRef.current;
      if (!currentInitData) {
        console.warn('[DataContext] loadBoardsData called before initData is available');
        return;
      }

      const isPartial = options?.partial ?? false;
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

        const {
          workers: workersData,
          allWorkspaceWorkers: allWorkersData,
          workspaces: wsData,
          tasks,
          metrics,
          sprintsByWorkspace,
        } = json.data;

        const tasksList = tasks ?? [];
        const wsById = new Map<string, string>(
          (wsData ?? []).map((w: any) => [w.id, w.task_prefix ?? 'TASK']),
        );

        const taskEntities: TaskEntity[] = tasksList
          .filter((task: any) => task && task.id)
          .map((task: any) => {
            const prefix = wsById.get(task.workspace_id) ?? 'TASK';
            return toTaskEntity(task, prefix);
          });

        // Tenant isolation: full load может вернуть задачи всех workspace —
        // в state.tasks оставляем только активный (если workspaceId задан).
        const tasksForStore =
          isPartial || !workspaceId
            ? taskEntities
            : taskEntities.filter((t) => (t as any).workspace_id === workspaceId);

        if (isPartial) {
          dispatch({ type: 'SET_WORKERS', payload: allWorkersData ?? workersData ?? [] });
        } else {
          dispatch({ type: 'SET_WORKERS', payload: workersData ?? [] });
          dispatch({ type: 'SET_WORKSPACES', payload: wsData ?? [] });
        }

        dispatch({ type: 'SET_TASKS', payload: tasksForStore });

        if (metrics) {
          dispatch({ type: 'SET_METRICS', payload: metrics });
        }

        // Board cards / riskData — только на full load
        if (!isPartial) {
          const allWorkspaceWorkers = allWorkersData ?? [];
          const sprintMap: Record<
            string,
            { name: string; topic: string; daysElapsed: number; totalDays: number }
          > = sprintsByWorkspace ?? {};

          const peopleSet = new Set<string>();
          let processCount = 0;
          let escalationCount = 0;

          tasksList.forEach((task: any) => {
            if (task.assigned_to) peopleSet.add(task.assigned_to);
            if (task.column === 'in_progress') processCount++;
            if (task.escalation_reason) escalationCount++;
          });

          const cards = (wsData ?? []).map((ws: any) => {
            const wsTasks = tasksList.filter((t: any) => t.workspace_id === ws.id);
            const wsAllWorkers = allWorkspaceWorkers.filter(
              (w: any) => w.workspace_id === ws.id,
            );

            const sp = sprintMap[ws.id];
            const cardSprint = sp
              ? {
                  name: sp.name,
                  topic: sp.topic,
                  daysElapsed: sp.daysElapsed,
                  totalDays: sp.totalDays,
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

        dispatch({ type: 'SET_FIRST_LOAD_DONE', payload: true });
        setDataError(null);
      } catch (err) {
        clearTimeout(timeoutId);
        const isAbort =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError');
        const message = isAbort
          ? 'timeout_loading_boards_data'
          : err instanceof Error
            ? err.message
            : 'failed_to_load_boards_data';
        console.error('[DataContext] failed to load boards data:', err);
        setDataError(message);
      }
    },
    [],
  );

  const workspacesKey =
    authData?.workspaces?.map((w: any) => w.id).join(',') ?? '';

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

    const activeWsId = (authData as any).last_active_workspace_id ?? null;
    const targetWorkspaceId = activeWsId || authData.worker.workspace_id;

    if (targetWorkspaceId) {
      dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: targetWorkspaceId });
      loadBoardsData(targetWorkspaceId, { partial: true });
    }
  }, [authData?.worker?.id, workspacesKey, loadBoardsData]);

  const setActiveWorkspace = useCallback(
    async (workspaceId: string) => {
      const currentInitData = initDataRef.current;
      if (!currentInitData) {
        console.warn('[DataContext] setActiveWorkspace called before initData is available');
        return;
      }

      dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: workspaceId });
      dispatch({ type: 'SET_METRICS', payload: null });
      dispatch({ type: 'SET_TASKS', payload: [] });
      setIsSwitchingWorkspace(true);

      fetch('/api/workspaces/active-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: currentInitData, workspace_id: workspaceId }),
      }).catch((err) =>
        console.error('[DataContext] Failed to save active workspace:', err),
      );

      try {
        await loadBoardsData(workspaceId, { partial: true });
      } finally {
        setIsSwitchingWorkspace(false);
      }
    },
    [loadBoardsData],
  );

  const workspacesRef = useRef(state.workspaces.items);
  useEffect(() => {
    workspacesRef.current = state.workspaces.items;
  }, [state.workspaces.items]);

  useEffect(() => {
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;

    const getPrefix = (wsId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      return ws?.task_prefix ?? 'TASK';
    };
    const prefix = getPrefix(workspaceId);
    const supabase = getClient();

    const handleRealtime = (payload: {
      eventType: string;
      new: TasksRow | null;
      old: TasksRow | null;
    }) => {
      if (activeWorkspaceIdRef.current !== workspaceId) {
        return;
      }

      if (process.env.NODE_ENV === 'development') {
        try {
          console.debug('[DataContext] realtime event:', {
            eventType: payload.eventType,
            newKeys:
              payload.new && typeof payload.new === 'object'
                ? Object.keys(payload.new)
                : undefined,
            newSerialized: payload.new
              ? JSON.stringify(payload.new).slice(0, 500)
              : null,
          });
        } catch {
          /* ignore */
        }
      }

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const raw = payload.new as TasksRow | null;
        if (!raw || typeof raw !== 'object' || !raw.id) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[DataContext] realtime: skipped malformed task payload:', {
              eventType: payload.eventType,
              raw,
              rawKeys: raw && typeof raw === 'object' ? Object.keys(raw) : undefined,
            });
          }
          return;
        }
        if (raw.workspace_id && raw.workspace_id !== workspaceId) {
          return;
        }
        const taskEntity = toTaskEntity(raw as any, prefix);
        dispatch({ type: 'PATCH_TASK', payload: taskEntity });
      } else if (payload.eventType === 'DELETE') {
        const oldTask = payload.old as TasksRow | null;
        if (!oldTask?.id) return;
        if (oldTask.workspace_id && oldTask.workspace_id !== workspaceId) {
          return;
        }
        dispatch({ type: 'REMOVE_TASK', payload: oldTask.id });
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
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (err) {
        console.warn('[DataContext] Failed to remove realtime channel:', err);
      }
    };
  }, [state.activeWorkspaceId]);

  return (
    <DataContext.Provider
      value={{
        state,
        dispatch,
        loadBoardsData,
        setActiveWorkspace,
        authData,
        isLoadingAuth,
        firstLoadDone: state._firstLoadDone,
        dataError,
        isSwitchingWorkspace,
        removeWorkspace: (workspaceId: string) =>
          dispatch({ type: 'REMOVE_WORKSPACE', payload: workspaceId }),
      }}
    >
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
