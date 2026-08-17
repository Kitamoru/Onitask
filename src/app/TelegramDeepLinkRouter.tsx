'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Handles deep links from Telegram Bot (t.me/bot/app?startapp=task_TASK-42).
 * Mount ONCE at the root level — after telegram-web-app.js has loaded.
 *
 * Flow:
 *   1. Read tg.initDataUnsafe.start_param
 *   2. Parse task full_id (e.g. "TASK-42")
 *   3. Navigate to /flowboard?open_task=TASK-42
 *
 * The flowboard page will read ?open_task and open TaskViewEdit sheet.
 */
export function TelegramDeepLinkRouter() {
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const tg = (window as any).Telegram?.WebApp;
    if (!tg) {
      console.warn('[TG] Telegram.WebApp unavailable at mount time — check Script strategy');
      return;
    }

    tg.ready();
    handled.current = true;

    const startParam = tg.initDataUnsafe?.start_param;
    if (!startParam) return;

    void routeByStartParam(startParam, router);
  }, [router]);

  return null;
}

async function routeByStartParam(startParam: string, router: ReturnType<typeof useRouter>) {
  // Match task deep links: "task_TASK-42"
  const taskMatch = startParam.match(/^task_([A-Za-z]+-\d+)$/);
  if (taskMatch) {
    const fullId = taskMatch[1];
    // Use setTimeout to avoid race condition with initial page load / Suspense
    setTimeout(() => {
      const currentPath = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      params.set('open_task', fullId);
      router.replace(`${currentPath}?${params.toString()}`, { scroll: false });
    }, 150);
    return;
  }

  // Future: flow deep links (§6.2d)
  const flowMatch = startParam.match(/^flow_([a-z0-9-]+)$/);
  if (flowMatch) {
    setTimeout(() => {
      router.replace(`/workspace/${flowMatch[1]}`);
    }, 150);
    return;
  }
}