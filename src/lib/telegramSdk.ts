/**
 * Общий хелпер ожидания Telegram Web App SDK.
 *
 * PERF-03: telegram-web-app.js грузится `afterInteractive` — не блокирует
 * рендер и гидратацию, поэтому на mount компонента `window.Telegram` ещё нет.
 * Готовность SDK ожидается явно поллингом.
 *
 * SDK парсит initData (включая start_param из ?startapp=) при своём исполнении,
 * поэтому появление window.Telegram.WebApp равносильно готовности initData.
 */

/** Сколько ждать появления window.Telegram.WebApp на холодном старте. */
export const SDK_WAIT_MS = 5000;
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

/** Auth cache is valid only for a normal launch without Telegram start_param. */
export function shouldUseCachedInit(
  startParam: string | undefined | null,
  allowCache: boolean,
): boolean {
  return allowCache && !startParam;
}
