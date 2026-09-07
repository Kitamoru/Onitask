'use client';

import React from 'react';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';
import { GlobalLoader } from './GlobalLoader';

/**
 * AuthLoader — управляет глобальным лоадером на основе состояния авторизации.
 *
 * Минимальные изменения: добавлена минимальная задержка скрытия лоадера
 * (LOADER_MIN_DISPLAY_MS = 400ms) — гарантирует что интерфейс не "мигает"
 * при быстрых ререндерах кэшированных данных.
 */

const LOADER_MIN_DISPLAY_MS = 400;

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
      const timer = setTimeout(() => setVisible(false), LOADER_MIN_DISPLAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isLoading, firstLoadDone, dataError, error]);

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