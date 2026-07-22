'use client';

import React from 'react';
import { useAppReady } from '@/hooks/useAppReady';
import { GlobalLoader } from './GlobalLoader';

/**
 * AuthLoader — клиентская обёртка, которая управляет глобальным лоадером.
 *
 * Использует useAppReady() для отслеживания полной готовности приложения:
 * - auth done + boards data loaded → ready=true
 * - Это предотвращает мигания: лоадер остаётся пока ВСЁ не загрузится
 *
 * Используется в layout.tsx для плавной загрузки при старте приложения.
 */

interface AuthLoaderProps {
  children: React.ReactNode;
}

export function AuthLoader({ children }: AuthLoaderProps) {
  const { isReady } = useAppReady();

  return (
    <>
      <GlobalLoader ready={isReady} />
      {children}
    </>
  );
}
