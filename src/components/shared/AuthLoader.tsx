'use client';

import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GlobalLoader } from './GlobalLoader';

/**
 * AuthLoader — клиентская обёртка, которая управляет глобальным лоадером
 * на основе состояния авторизации.
 *
 * Используется в layout.tsx для плавной загрузки при старте приложения.
 */

interface AuthLoaderProps {
  children: React.ReactNode;
}

export function AuthLoader({ children }: AuthLoaderProps) {
  const { isLoading } = useAuth();

  return (
    <>
      <GlobalLoader ready={!isLoading} />
      {children}
    </>
  );
}