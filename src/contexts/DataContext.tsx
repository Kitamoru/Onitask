'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type { Database } from '../../types/supabase';
import { getClient } from '@/lib/supabase/client';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Worker = Database['public']['Tables']['workers']['Row'];

export interface FlowMetrics {
  sprint?: {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    goal?: string;
  };
  columns: Array<{
    name: string;
    wip_current: number;
    wip_limit?: number;
    health: 'green' | 'yellow' | 'red';
  }>;
  workers: Array<{
    display_name: string;
    type: 'human' | 'agent';
    status: 'normal' | 'overloaded';
    cognitive_load: number;
  }>;
  alerts: Array<{
    id: string;
    type: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
}

interface DataStore {
  auth: {
    data: import('../../types/api').InitResponse | null;
    isLoading: boolean;
    error: string | null;
  };
  tasks: {
    items: TasksRow[];
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
}

type Action =
  | { type: 'SET_AUTH_LOADING'; payload: boolean }
  | { type: 'SET_AUTH_DATA'; payload: import('../../types/api').InitResponse }
  | { type: 'SET_AUTH_ERROR'; payload: string | null }
  | { type: 'SET_TASKS'; payload: TasksRow[] }
  | { type: 'PATCH_TASK'; payload: TasksRow }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'SET_METRICS'; payload: FlowMetrics }
  | { type: 'SET_WORKSPACES'; payload: Workspace[] }
  | { type: 'SET_WORKERS'; payload: Worker[] }
  | { type: 'HYDRATE_FROM_STORAGE'; payload: Partial<DataStore> };

const initialState: DataStore = {
  auth: {
    data: null,
    isLoading: true,
    error: null,
  },
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
};

function dataReducer(state: DataStore, action: Action): DataStore {
  switch (action.type) {
    case 'SET_AUTH_LOADING':
      return {
        ...state,
        auth: { ...state.auth, isLoading: action.payload },
      };

    case 'SET_AUTH_DATA':
      return {
        ...state,
        auth: {
          data: action.payload,
          isLoading: false,
          error: null,
        },
      };

    case 'SET_AUTH_ERROR':
      return {
        ...state,
        auth: {
          ...state.auth,
          error: action.payload,
          isLoading: false,
        },
      };

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

    case 'HYDRATE_FROM_STORAGE':
      return {
        ...state,
        ...action.payload,
      };

    default:
      return state;
  }
}

interface DataContextValue {
  state: DataStore;
  dispatch: React.Dispatch<Action>;
  refreshAuth: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, initialState);

  const refreshAuth = useCallback(async () => {
    dispatch({ type: 'SET_AUTH_LOADING', payload: true });
    try {
      const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
      const telegramWebApp = globalWindow?.Telegram?.WebApp;
      const hasInitData = !!telegramWebApp?.initData;

      if (!hasInitData) {
        dispatch({ type: 'SET_AUTH_ERROR', payload: 'not_in_twa' });
        return;
      }

      const startParam = telegramWebApp.initDataUnsafe?.start_param || '';

      const res = await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: telegramWebApp.initData,
          start_param: startParam,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || errData.message || 'init_failed');
      }

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'init_failed');
      }

      dispatch({ type: 'SET_AUTH_DATA', payload: json.data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'init_error';
      dispatch({ type: 'SET_AUTH_ERROR', payload: message });
    }
  }, []);

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('onitask_data');
      if (raw) {
        const cached = JSON.parse(raw);
        dispatch({ type: 'HYDRATE_FROM_STORAGE', payload: cached });
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist to sessionStorage on changes
  useEffect(() => {
    const timer = setTimeout(() => {
      sessionStorage.setItem('onitask_data', JSON.stringify(state));
    }, 100);
    return () => clearTimeout(timer);
  }, [state]);

  // Subscribe to realtime task changes
  useEffect(() => {
    const workspaceId = state.auth.data?.worker?.workspace_id;
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
            dispatch({ type: 'PATCH_TASK', payload: payload.new as TasksRow });
          } else if (payload.eventType === 'DELETE') {
            dispatch({ type: 'REMOVE_TASK', payload: (payload.old as TasksRow).id });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [state.auth.data?.worker?.workspace_id]);

  return (
    <DataContext.Provider value={{ state, dispatch, refreshAuth }}>
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