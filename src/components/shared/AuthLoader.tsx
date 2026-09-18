'use client';

import React from 'react';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';
import { GlobalLoader } from './GlobalLoader';
import { markPerf, reportPerf } from '@/lib/perf/timings';

/**
 * AuthLoader — управляет глобальным лоадером на основе состояния авторизации.
 *
 * PERF-07: минимальная задержка снижена 400ms → 120ms. Раньше 400ms + 300ms
 * fade-out в GlobalLoader давали до 0.7s «мёртвой» паузы ПОСЛЕ того, как данные
 * уже пришли (на каждом запуске). 120ms достаточно, чтобы не мигать на кэш-хитах.
 */

const LOADER_MIN_DISPLAY_MS = 120;

interface AuthLoaderProps {
  children: React.ReactNode;
}

export function AuthLoader({ children }: AuthLoaderProps) {
  const { isLoading, error } = useTelegramAuth();
  const { firstLoadDone, dataError } = useData();
  const [visible, setVisible] = React.useState(true);
  const resolvedRef = React.useRef(false);

  React.useEffect(() => {
    // Release the loader when auth AND (first data load OR a data/auth error) resolve.
    // Without `dataError`/`error` here, any failure (or a brand-new user with no
    // workspace, where loadBoardsData is never called) leaves the GlobalLoader
    // visible forever and masks the error screens behind it.
    if (!isLoading && (firstLoadDone || dataError || error) && !resolvedRef.current) {
      resolvedRef.current = true;
      // Keep loader visible for minimum display time to prevent flash
      const timer = setTimeout(() => {
        markPerf('ui:ready'); // PERF-06
        setVisible(false);
        reportPerf(); // PERF-06: разовый отчёт по фазам boot (только при ?perf=1)
      }, LOADER_MIN_DISPLAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isLoading, firstLoadDone, dataError, error]);

  // PERF-06: фиксируем момент готовности данных (до отрисовки UI).
  React.useEffect(() => {
    if (firstLoadDone) markPerf('data:done');
  }, [firstLoadDone]);

  // Safety fallback: never block the whole UI for more than 10s,
  // regardless of unresolved auth/data state (e.g. hung fetch).
  React.useEffect(() => {
    const fallback = setTimeout(() => {
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        setVisible(false);
      }
    }, 10000);
    return () => clearTimeout(fallback);
  }, []);

  return (
    <>
      <GlobalLoader ready={!visible} />
      {children}
    </>
  );
}