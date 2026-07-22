'use client';

import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useData } from '@/contexts/DataContext';

/**
 * useAppReady — объединённое состояние готовности приложения.
 *
 * Возвращает `isReady: true` ТОЛЬКО когда:
 * 1. Авторизация завершена (auth.done)
 * 2. Основные данные загружены (boards data loaded)
 *
 * Это позволяет GlobalLoader оставаться видимым直到 ВСЁ готово,
 * избегая миганий и ререндеров на полупустом интерфейсе.
 */

export function useAppReady(): { isReady: boolean; phase: 'initializing' | 'loading' | 'ready' } {
  const { isLoading: authLoading } = useAuth();
  const { state } = useData();

  const result = useMemo(() => {
    // Phase 1: Auth not yet resolved
    if (authLoading) {
      return { isReady: false, phase: 'initializing' as const };
    }

    // Phase 2: Auth done, but boards data not loaded yet
    if (!state.boards.lastUpdated) {
      return { isReady: false, phase: 'loading' as const };
    }

    // Phase 3: Everything ready
    return { isReady: true, phase: 'ready' as const };
  }, [authLoading, state.boards.lastUpdated]);

  return result;
}