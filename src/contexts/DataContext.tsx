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
import { useQueryClient } from '@tanstack/react-query';
import type { Database } from '../../types/supabase';
import type { FlowMetricsResponse } from '../types/flowboard';
import type { TaskEntity } from '@/types/flowboard';
import { getClient } from '@/lib/supabase/client';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { buildFullId } from '@/lib/realtime/tasks';
import { BOARD_COUNTS_QUERY_KEY, fetchBoardCounts } from '@/lib/api/boardCounts';
import { createLatestLoadGuard } from '@/lib/latestLoadGuard';

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
    story_points: (raw as any).story_points === undefined ? null : (raw as any).story_points,
  } as TaskEntity;
}

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Worker = Database['public']['Tables']['workers']['Row'];

export type FlowMetrics = FlowMetricsResponse;

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
  // boards удалён (BOARD-AGG): агрегаты «Стола» переехали в React Query
  // (useBoardCounts) — сервер считает counts/riskData/members/sprints.
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
  | { type: 'SET_FIRST_LOAD_DONE'; payload: true }
  | { type: 'CLEAR_ALL'; payload: null };

const initialState: DataStore = {
  tasks: { items: [], lastUpdated: null },
  metrics: { data: null, lastUpdated: null },
  workspaces: { items: [], lastUpdated: null },
  workers: { items: [], lastUpdated: null },
  activeWorkspaceId: null,
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
      };
    case 'SET_WORKERS':
      return {
        ...state,
        workers: { items: action.payload, lastUpdated: Date.now() },
      };
    case 'SET_ACTIVE_WORKSPACE':
      return { ...state, activeWorkspaceId: action.payload };
    // SET_BOARDS удалён (BOARD-AGG): карточки досок теперь серверные агрегаты
    // через React Query (queryKey ['board-counts'], см. hooks/useBoardCounts).
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

  const loadGuardRef = useRef(createLatestLoadGuard());
  const activeWorkspaceSaveRef = useRef<Promise<void>>(Promise.resolve());
  const activeWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeWorkspaceIdRef.current = state.activeWorkspaceId;
  }, [state.activeWorkspaceId]);

  const [dataError, setDataError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const queryClient = useQueryClient();
  const lastCountsInvalidateRef = useRef(0);
  // BOARD-AGG: realtime-события задач → помечаем агрегаты «Стола» протухшими
  // (троттл 3s — invalidate дешёвый, но штормить refetch при bulk-insert не нужно).
  const invalidateCountsThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastCountsInvalidateRef.current < 3000) return;
    lastCountsInvalidateRef.current = now;
    void queryClient.invalidateQueries({ queryKey: BOARD_COUNTS_QUERY_KEY });
  }, [queryClient]);

  // BOARD-AGG: prefetch агрегатов «Стола» сразу после первого лоада — первый
  // переход на /boards рисуется мгновенно из кэша (блюр-заглушки не показываются).
  useEffect(() => {
    if (!state._firstLoadDone || !initDataRef.current) return;
    const initData = initDataRef.current;
    void queryClient.prefetchQuery({
      queryKey: BOARD_COUNTS_QUERY_KEY,
      queryFn: () => fetchBoardCounts(initData),
    });
  }, [state._firstLoadDone, queryClient]);

  const loadBoardsData = useCallback(
    async (workspaceId?: string, options?: { partial?: boolean }) => {
      const currentInitData = initDataRef.current;
      if (!currentInitData) {
        console.warn('[DataContext] loadBoardsData called before initData is available');
        // Do not block the UI in a broken environment (no Telegram initData):
        // release the first-load gate so the GlobalLoader can hide.
        dispatch({ type: 'SET_FIRST_LOAD_DONE', payload: true });
        return;
      }

      const isPartial = options?.partial ?? false;
      const generation = loadGuardRef.current.begin();
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

        if (!loadGuardRef.current.isCurrent(generation)) return;

        const {
          workers: workersData,
          allWorkspaceWorkers: allWorkersData,
          workspaces: wsData,
          tasks,
          metrics,
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

        // BOARD-AGG: board cards / riskData больше не считаются здесь —
        // агрегаты «Стола» живут в React Query (useBoardCounts).

        dispatch({ type: 'SET_FIRST_LOAD_DONE', payload: true });
        setDataError(null);
      } catch (err) {
        clearTimeout(timeoutId);
        if (!loadGuardRef.current.isCurrent(generation)) return;
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
        // Release the first-load gate even on failure, so dataError screens
        // with a retry button become reachable instead of an infinite loader.
        dispatch({ type: 'SET_FIRST_LOAD_DONE', payload: true });
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
      role_title: null,
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

    const activeWsId = authData.launch_context?.workspace_id ?? authData.last_active_workspace_id ?? null;
    const targetWorkspaceId = activeWsId || authData.worker.workspace_id;

    if (targetWorkspaceId) {
      dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: targetWorkspaceId });
      loadBoardsData(targetWorkspaceId, { partial: true });
    } else {
      // Brand-new user without any workspace (is_new_user=true): there is no
      // server data to load. Release the first-load gate so AuthLoader hides
      // the GlobalLoader and the onboarding flow (/board/create) can render.
      // Previously this branch was a no-op and firstLoadDone stayed false
      // forever — infinite loading for every new user (fixes onboarding bug).
      dispatch({ type: 'SET_FIRST_LOAD_DONE', payload: true });
    }
  }, [authData?.worker?.id, authData?.launch_context?.workspace_id, workspacesKey, loadBoardsData]);

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

      activeWorkspaceSaveRef.current = activeWorkspaceSaveRef.current.then(async () => {
        try {
          const saveResponse = await fetch('/api/workspaces/active-workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ init_data: currentInitData, workspace_id: workspaceId }),
          });
          if (!saveResponse.ok) {
            console.error('[DataContext] Failed to save active workspace:', saveResponse.status);
          }
        } catch (err) {
          console.error('[DataContext] Failed to save active workspace:', err);
        }
      });
      void activeWorkspaceSaveRef.current;

      try {
        await loadBoardsData(workspaceId, { partial: true });
      } finally {
        setIsSwitchingWorkspace(false);
      }
    },
    [loadBoardsData],
  );

  const tasksRef = useRef(state.tasks.items);
  useEffect(() => {
    tasksRef.current = state.tasks.items;
  }, [state.tasks.items]);

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
        const previousTask = tasksRef.current.find((task) => task.id === raw.id);
        const taskEntity = toTaskEntity({ ...(raw as any), story_points: (raw as any).story_points ?? previousTask?.story_points }, prefix);
        dispatch({ type: 'PATCH_TASK', payload: taskEntity });
        invalidateCountsThrottled();
      } else if (payload.eventType === 'DELETE') {
        const oldTask = payload.old as TasksRow | null;
        if (!oldTask?.id) return;
        if (oldTask.workspace_id && oldTask.workspace_id !== workspaceId) {
          return;
        }
        dispatch({ type: 'REMOVE_TASK', payload: oldTask.id });
        invalidateCountsThrottled();
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
  }, [state.activeWorkspaceId, invalidateCountsThrottled]);

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
