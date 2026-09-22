/**
 * Общий хелпер ожидания Telegram Web App SDK.
 *
 * PERF-03: telegram-web-app.js грузится `afterInteractive` — не блокирует
 * рендер и гидратацию, поэтому на mount компонента `window.Telegram` ещё нет.
 * Готовность SDK ожидается явно поллингом.
 *
 * SDK парсит initData (включая start_param из ?startapp=) при своём исполнении,
 * поэтому появление window.Telegram.WebApp равносильно готовности initData.
 *
 * Используется и в useTelegramAuth (boot-цепочка авторизации), и в
 * TelegramDeepLinkRouter (deep links «Открыть в приложении») — до выделения
 * в модуль логика дублировалась/терялась, из-за чего deep link молча умирал.
 */

/** Сколько ждать появления window.Telegram.WebApp на холодном старте. */
export const SDK_WAIT_MS = 1500;
/** Интервал поллинга window.Telegram.WebApp. */
export const SDK_POLL_MS = 50;

type TelegramWebApp = {
  ready: () => void;
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
  };
};

/**
 * Ждёт появления window.Telegram.WebApp (SDK afterInteractive).
 * Возвращает WebApp или null по таймауту.
 */
export async function waitForTelegramWebApp(
  timeoutMs: number = SDK_WAIT_MS,
): Promise<TelegramWebApp | null> {
  if (typeof window === 'undefined') return null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) return tg as TelegramWebApp;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, SDK_POLL_MS));
  }
}

/** Результат разбора deep link из start_param. */
export interface TaskStartParam {
  /** full_id задачи, например «ONI-42». */
  fullId: string;
  /** Целевая вкладка TaskViewEdit. */
  tab: 'general' | 'comments';
}

/**
 * Разбирает start_param из deep link бота.
 * Поддерживает:
 *   task_ONI-42              → вкладка «Общее»
 *   task_ONI-42_comments     → вкладка «Комментарии» (FILE-03)
 * Возвращает null для start_param, не соответствующих известным шаблонам.
 */
export function parseTaskStartParam(param: string | undefined | null): TaskStartParam | null {
  if (!param) return null;
  const m = param.match(/^task_([A-Za-z]+-\d+)(_comments)?$/);
  if (!m) return null;
  return { fullId: m[1], tab: m[2] ? 'comments' : 'general' };
}

/**
 * Строит query для /flowboard по разобранному deep link.
 * Возвращает null, если start_param не матчится ни под один шаблон.
 */
export function flowboardQueryFromStartParam(param: string): string | null {
  const parsed = parseTaskStartParam(param);
  if (parsed) {
    const q = new URLSearchParams({ open_task: parsed.fullId });
    if (parsed.tab === 'comments') q.set('tab', 'comments');
    return `/flowboard?${q.toString()}`;
  }
  // Future: flow deep links (§6.2d): flow_<handle> → /workspace/<handle>
  const flowMatch = param.match(/^flow_([a-z0-9-]+)$/);
  if (flowMatch) return `/workspace/${flowMatch[1]}`;
  return null;
}
