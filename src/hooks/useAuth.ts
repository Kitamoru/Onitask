'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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

export function useAuth(): UseAuthReturn {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InitResponse | null>(null);
  const [isTWA, setIsTWA] = useState(false);

  const fetchInit = useCallback(async () => {
    // Check if we're in Telegram WebApp
    const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
    const telegramWebApp = globalWindow?.Telegram?.WebApp;
    const hasInitData = !!telegramWebApp?.initData;

    setIsTWA(!!hasInitData);

    if (!hasInitData) {
      setError('not_in_twa');
      setIsLoading(false);
      return;
    }

    // Try to load from storage first (avoid unnecessary API calls on refresh)
    const cached = loadFromStorage();
    if (cached && !router) {
      setData(cached);
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
      setData(initResponse);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'init_error';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!mounted) return;

      // Check if we're in Telegram WebApp
      const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
      const telegramWebApp = globalWindow?.Telegram?.WebApp;

      if (!telegramWebApp?.initData) {
        if (!mounted) return;
        setIsTWA(false);
        setError('not_in_twa');
        setIsLoading(false);
        return;
      }

      setIsTWA(true);

      // Try cache first
      const cached = loadFromStorage();
      if (cached) {
        if (!mounted) return;
        setData(cached);
        setIsLoading(false);
        return;
      }

      // Fetch from server
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
        if (!mounted) return;
        setData(initResponse);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : 'init_error';
        setError(message);
        setData(null);
      } finally {
        if (!mounted) return;
        setIsLoading(false);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isLoading,
    error,
    data,
    isTWA,
    refresh: fetchInit,
  };
}