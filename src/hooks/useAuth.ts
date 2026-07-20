'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { InitResponse } from '../../types/api';

/**
 * useAuth — Telegram Web App authentication hook.
 *
 * On mount:
 * 1. Reads Telegram.initData from window (if available in TWA).
 * 2. Calls POST /api/init with initData + optional start_param.
 * 3. Stores the response in sessionStorage.
 * 4. Exposes loading/error/user state for consumers.
 *
 * Graceful degradation: if not in TWA, returns loading=false with error='not_in_twa'.
 */

interface UseAuthReturn {
  isLoading: boolean;
  error: string | null;
  data: InitResponse | null;
  /** Whether the Telegram WebApp environment is available */
  isTWA: boolean;
  /** Refresh auth data (re-call /api/init) */
  refresh: () => void;
}

const STORAGE_KEY = 'onitask_auth';

function loadFromStorage(): InitResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(data: InitResponse): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Deep equality check for InitResponse
function dataEqual(a: InitResponse | null, b: InitResponse | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.worker.id === b.worker.id &&
    a.worker.display_name === b.worker.display_name &&
    a.is_new_user === b.is_new_user
  );
}

export function useAuth(): UseAuthReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InitResponse | null>(null);
  const [isTWA, setIsTWA] = useState(false);
  const dataRef = useRef<InitResponse | null>(null);
  const initRanRef = useRef(false);

  const performInit = useCallback(async () => {
    const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
    const telegramWebApp = globalWindow?.Telegram?.WebApp;
    const hasInitData = !!telegramWebApp?.initData;

    setIsTWA(!!hasInitData);

    if (!hasInitData) {
      setError('not_in_twa');
      setIsLoading(false);
      return;
    }

    try {
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

      const initResponse = json.data as InitResponse;
      saveToStorage(initResponse);
      dataRef.current = initResponse;
      setData(initResponse);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'init_error';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Run init once on mount
  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;
    performInit();
  }, [performInit]);

  // Return stable reference - use dataRef to prevent new object on every render
  // when data is null (useMemo with null deps still creates new ref)
  const stableData = dataRef.current;

  return {
    isLoading,
    error,
    data: stableData,
    isTWA,
    refresh: performInit,
  };
}