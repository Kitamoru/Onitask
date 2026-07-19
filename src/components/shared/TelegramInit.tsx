'use client';

import { useEffect, useRef } from 'react';

// eslint-disable-next-line import/no-unresolved
import { useTelegram } from '@/hooks/useTelegram';

/**
 * Client-only component that initializes Telegram WebApp SDK on mount.
 *
 * - Calls tg.ready(), tg.expand() inside useEffect → no SSR mismatch.
 * - Uses a ref gate so effects fire exactly once.
 * - Logs diagnostic info for debugging auth issues.
 * - Renders nothing (returns null).
 */
export function TelegramInit() {
  const telegram = useTelegram();

  // Ref gate — ensure this effect runs at most once even with React StrictMode
  const initRanRef = useRef(false);

  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;

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
      console.log(
        '[Telegram]    window.Telegram?.WebApp:',
        typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : 'N/A (SSR)'
      );
    }
  }, [telegram.isAvailable, telegram.isExpanded, telegram.viewportHeight, telegram.viewportStableHeight, telegram.initData, telegram.initDataUnsafe, telegram.startParam]);

  return null; // This component renders nothing
}