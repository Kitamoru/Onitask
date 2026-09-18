'use client';

/**
 * PERF-06 — временная инструментация холодного старта TWA.
 *
 * ВКЛЮЧАЕТСЯ ТОЛЬКО ЯВНО: `?perf=1` в URL или `startapp=perf` в deep-link.
 * Для обычных пользователей модуль не делает ничего: ни марок, ни отправки,
 * ни лишних запросов — поэтому на производительность не влияет.
 *
 * Зачем: реальные цифры boot-времени внутри Telegram WebView иначе недоступны
 * (Desktop-Telegram не даёт полноценный HAR, а console.log из WebView не виден).
 * Отчёт уходит один раз за сессию в /api/debug/timings (там только console.info
 * на стороне Vercel).
 *
 * ⚠️ После снятия метрик «до/после» — удалить: этот файл, /api/debug/timings
 * и вызовы markPerf()/reportPerf() (см. docs/TASKS.md → PERF-06).
 */

const FLAG = 'perf';
const SENT_KEY = 'onitask_perf_sent';

let enabled: boolean | null = null;

export function perfEnabled(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === 'undefined') return false; // SSR: не кэшируем результат
  try {
    const fromQuery = new URLSearchParams(window.location.search).get(FLAG) === '1';
    const fromHash = window.location.hash.includes(`${FLAG}=1`);
    const startParam = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } })
      .Telegram?.WebApp?.initDataUnsafe?.start_param;
    enabled = fromQuery || fromHash || startParam === FLAG;
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Поставить метку фазы boot. Безопасно вызывать всегда — no-op без флага. */
export function markPerf(name: string): void {
  if (!perfEnabled() || typeof performance === 'undefined') return;
  try {
    performance.mark(name);
  } catch {
    /* no-op */
  }
}

function lastMark(name: string): number | null {
  const list = performance.getEntriesByName(name, 'mark');
  if (list.length === 0) return null;
  return Math.round(list[list.length - 1].startTime);
}

/** Отправить разовый отчёт (marks + navigation timing) в /api/debug/timings. */
export function reportPerf(): void {
  if (!perfEnabled() || typeof performance === 'undefined') return;
  try {
    if (sessionStorage.getItem(SENT_KEY)) return;
    sessionStorage.setItem(SENT_KEY, '1');
  } catch {
    /* приватный режим — просто отправляем без дедупа */
  }

  const phases = [
    't0',
    'init:start',
    'init:data-ready',
    'init:done',
    'route:flowboard',
    'data:done',
    'ui:ready',
  ];
  const timings: Record<string, number> = {};
  for (const phase of phases) {
    const value = lastMark(phase);
    if (value !== null) timings[phase] = value;
  }

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const payload = {
    path: window.location.pathname,
    start_param: (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } })
      .Telegram?.WebApp?.initDataUnsafe?.start_param ?? null,
    timings,
    nav: nav
      ? {
          ttfb: Math.round(nav.responseStart),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd || 0),
          type: nav.type,
        }
      : null,
    vp: `${window.innerWidth}x${window.innerHeight}`,
  };

  console.info('[PERF] boot timings', timings);

  const body = JSON.stringify(payload);
  try {
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/debug/timings', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    /* fallthrough ниже */
  }
  void fetch('/api/debug/timings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}