'use client';

import React from 'react';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
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
  const { isLoading } = useTelegramAuth();
  const [visible, setVisible] = React.useState(true);
  const resolvedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isLoading && !resolvedRef.current) {
      resolvedRef.current = true;
      // Keep loader visible for minimum display time to prevent flash
      const timer = setTimeout(() => setVisible(false), LOADER_MIN_DISPLAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  return (
    <>
      <GlobalLoader ready={!visible} />
      {children}
    </>
  );
}