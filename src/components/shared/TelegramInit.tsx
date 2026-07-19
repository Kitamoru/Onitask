'use client';

import { useEffect } from 'react';

// eslint-disable-next-line import/no-unresolved
import { useTelegram } from '@/hooks/useTelegram';

/**
 * Client-only component that initializes Telegram Web App SDK.
 * Calls tg.ready(), tg.expand(), and requests fullscreen on mount.
 * Gracefully degrades when not in Telegram (SSR / browser).
 */
export function TelegramInit() {
  const telegram = useTelegram();

  useEffect(() => {
    // Log availability for debugging
    if (telegram.isAvailable) {
      console.log('[Telegram] WebApp initialized, isExpanded:', telegram.isExpanded);
    } else {
      console.log('[Telegram] Not running inside Telegram WebApp');
    }
  }, [telegram.isAvailable, telegram.isExpanded]);

  return null; // This component renders nothing
}