'use client';

import { useEffect } from 'react';

// eslint-disable-next-line import/no-unresolved
import { useTelegram } from '@/hooks/useTelegram';

/**
 * Client-only component that initializes Telegram Web App SDK.
 * Calls tg.ready(), tg.expand(), and requests fullscreen on mount.
 * Gracefully degrades when not in Telegram (SSR / browser).
 *
 * Also logs diagnostic info for debugging Telegram auth issues.
 */
export function TelegramInit() {
  const telegram = useTelegram();

  useEffect(() => {
    if (telegram.isAvailable) {
      console.log('[Telegram] ✅ WebApp initialized');
      console.log('[Telegram]    isExpanded:', telegram.isExpanded);
      console.log('[Telegram]    viewportHeight:', telegram.viewportHeight);
      console.log('[Telegram]    viewportStableHeight:', telegram.viewportStableHeight);
      console.log('[Telegram]    hasInitData:', !!telegram.initData);
      console.log('[Telegram]    user:', telegram.initDataUnsafe?.user);
      console.log('[Telegram]    start_param:', telegram.startParam);

      // Warn if initData is empty — this means auth will fail
      if (!telegram.initData) {
        console.warn(
          '[Telegram] ⚠️ WebApp is available but initData is empty. ' +
          'Make sure the app is opened inside Telegram Mini App, not in a browser.'
        );
      }
    } else {
      console.log('[Telegram] ❌ Not running inside Telegram WebApp');
      console.log('[Telegram]    window.Telegram?.WebApp:', typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : 'N/A (SSR)');
    }
  }, [telegram.isAvailable, telegram.isExpanded, telegram.viewportHeight, telegram.viewportStableHeight, telegram.initData, telegram.initDataUnsafe, telegram.startParam]);

  return null; // This component renders nothing
}