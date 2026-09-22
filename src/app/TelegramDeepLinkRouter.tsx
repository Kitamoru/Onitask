'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { flowboardQueryFromStartParam, waitForTelegramWebApp } from '@/lib/telegramSdk';

/**
 * Handles deep links from Telegram Bot (t.me/bot/app?startapp=task_TASK-42).
 * Mount ONCE at the root level.
 *
 * Flow:
 *   1. Wait for Telegram SDK (PERF-03: it loads afterInteractive)
 *   2. Read tg.initDataUnsafe.start_param
 *   3. Navigate to /flowboard?open_task=TASK-42
 *
 * The flowboard page will read ?open_task and open TaskViewEdit sheet.
 */
export function TelegramDeepLinkRouter() {
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    let cancelled = false;

    void waitForTelegramWebApp().then((tg) => {
      if (cancelled) return;
      if (!tg) {
        console.warn('[TG-DL] Telegram.WebApp unavailable (SDK wait timed out)');
        return;
      }

      tg.ready();

      const startParam = tg.initDataUnsafe?.start_param;

      if (!startParam) {
        console.info('[TG-DL] No start_param — normal launch, not a deep link');
        return;
      }

      console.info('[TG-DL] start_param detected:', startParam);
      void routeByStartParam(startParam, router);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}

async function routeByStartParam(
  startParam: string,
  router: ReturnType<typeof useRouter>,
) {
  console.info('[TG-DL] Processing start_param:', startParam);

  const query = flowboardQueryFromStartParam(startParam);
  if (query) {
    console.info('[TG-DL] Navigating to:', query);
    // Use setTimeout to avoid race condition with initial page load / Suspense.
    // Delay increased to ensure Next.js routing is fully stable.
    setTimeout(() => {
      router.replace(query, { scroll: false });
    }, 500);
    return;
  }

  console.warn('[TG-DL] start_param does not match known patterns:', startParam);
}
