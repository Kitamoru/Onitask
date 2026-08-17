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
    handled.current = true;

    const tg = (window as any).Telegram?.WebApp;

    if (!tg) {
      console.warn('[TG-DL] Telegram.WebApp unavailable at mount time');
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
  }, [router]);

  return null;
}

async function routeByStartParam(
  startParam: string,
  router: ReturnType<typeof useRouter>,
) {
  console.info('[TG-DL] Processing start_param:', startParam);

  // Match task deep links: "task_BOOP-39"
  const taskMatch = startParam.match(/^task_([A-Za-z]+-\d+)$/);
  if (taskMatch) {
    const fullId = taskMatch[1];
    console.info('[TG-DL] Task deep link detected, fullId:', fullId);

    // Use setTimeout to avoid race condition with initial page load / Suspense.
    // Delay increased to ensure Next.js routing is fully stable.
    setTimeout(() => {
      const targetPath = `/flowboard?open_task=${encodeURIComponent(fullId)}`;
      console.info('[TG-DL] Navigating to:', targetPath);
      router.replace(targetPath, { scroll: false });
    }, 500);
    return;
  }

  // Future: flow deep links (§6.2d)
  const flowMatch = startParam.match(/^flow_([a-z0-9-]+)$/);
  if (flowMatch) {
    setTimeout(() => {
      router.replace(`/workspace/${flowMatch[1]}`, { scroll: false });
    }, 500);
    return;
  }

  console.warn('[TG-DL] start_param does not match known patterns:', startParam);
}