'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handled = useRef(false);
  const [debugInfo, setDebugInfo] = useState<string>('');

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const tg = (window as any).Telegram?.WebApp;
    
    if (!tg) {
      const msg = '[TG] Telegram.WebApp unavailable at mount time';
      console.warn(msg);
      setDebugInfo(msg);
      return;
    }

    tg.ready();
    
    const startParam = tg.initDataUnsafe?.start_param;
    const currentUrl = window.location.href;
    const currentOpenTask = searchParams.get('open_task');
    
    setDebugInfo(`start_param="${startParam}" | url="${currentUrl}" | open_task=${currentOpenTask}`);
    
    if (!startParam) {
      console.log('[TG] No start_param in initDataUnsafe — normal launch, not a deep link');
      return;
    }

    void routeByStartParam(startParam, router, pathname);
  }, [router, pathname, searchParams]);

  // Debug display (only in development)
  if (process.env.NODE_ENV === 'development' && debugInfo) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 8,
          left: 8,
          zIndex: 9999,
          background: '#000',
          color: '#0f0',
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'monospace',
          borderRadius: 4,
          opacity: 0.85,
        }}
      >
        {debugInfo}
      </div>
    );
  }

  return null;
}

async function routeByStartParam(
  startParam: string,
  router: ReturnType<typeof useRouter>,
  currentPathname: string,
) {
  console.log('[TG] Processing start_param:', startParam);

  // Match task deep links: "task_BOOP-39"
  const taskMatch = startParam.match(/^task_([A-Za-z]+-\d+)$/);
  if (taskMatch) {
    const fullId = taskMatch[1];
    console.log('[TG] Task deep link detected, fullId:', fullId);
    
    // Use setTimeout to avoid race condition with initial page load / Suspense
    // Increase delay to ensure Next.js routing is stable
    setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      params.set('open_task', fullId);
      const query = params.toString();
      const targetPath = `${currentPathname}${query ? '?' + query : ''}`;
      
      console.log('[TG] Navigating to:', targetPath);
      router.replace(targetPath, { scroll: false });
    }, 300);
    return;
  }

  // Future: flow deep links (§6.2d)
  const flowMatch = startParam.match(/^flow_([a-z0-9-]+)$/);
  if (flowMatch) {
    setTimeout(() => {
      router.replace(`/workspace/${flowMatch[1]}`, { scroll: false });
    }, 300);
    return;
  }

  console.log('[TG] start_param does not match known patterns:', startParam);
}