/**
 * swipeLogger — система логирования для отладки свайпов в Telegram Web App.
 * Записывает все события и ошибки в localStorage, чтобы их можно было просмотреть
 * из самого приложения без доступа к консоли браузера.
 */

const LOG_STORAGE_KEY = 'swipe_debug_logs';
const MAX_LOG_ENTRIES = 200; // максимальное количество записей в хранилище

export interface SwipeLogEntry {
  id: string;
  timestamp: string;
  type: 'event' | 'error' | 'state' | 'warning';
  component?: string;
  message: string;
  data?: Record<string, unknown>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getLogs(): SwipeLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SwipeLogEntry[];
  } catch {
    return [];
  }
}

function setLogs(logs: SwipeLogEntry[]): void {
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOG_ENTRIES)));
  } catch {
    // Если localStorage переполнен — очищаем старые записи
    try {
      const existing = getLogs();
      const trimmed = existing.slice(-Math.floor(MAX_LOG_ENTRIES / 2));
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ничего не делаем — хранилище недоступно
    }
  }
}

function appendLog(entry: Omit<SwipeLogEntry, 'id' | 'timestamp'>): void {
  const log: SwipeLogEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  const logs = getLogs();
  logs.push(log);
  setLogs(logs);
}

/** Логирование события (touchstart, touchmove и т.д.) */
export function logEvent(component: string, message: string, data?: Record<string, unknown>): void {
  appendLog({ type: 'event', component, message, data });
}

/** Логирование ошибки */
export function logError(component: string, error: Error | unknown, data?: Record<string, unknown>): void {
  const errorData = {
    ...(data || {}),
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
  };
  appendLog({ type: 'error', component, message: error instanceof Error ? error.message : String(error), data: errorData });
}

/** Логирование состояния компонента */
export function logState(component: string, message: string, data?: Record<string, unknown>): void {
  appendLog({ type: 'state', component, message, data });
}

/** Логирование предупреждения */
export function logWarning(component: string, message: string, data?: Record<string, unknown>): void {
  appendLog({ type: 'warning', component, message, data });
}

/** Очистка всех логов */
export function clearLogs(): void {
  try {
    localStorage.removeItem(LOG_STORAGE_KEY);
  } catch {
    // Игнорируем
  }
}

/** Получение последних N записей */
export function getRecentLogs(count: number = 50): SwipeLogEntry[] {
  const logs = getLogs();
  return logs.slice(-count);
}

/** Проверка наличия критических ошибок за последние N минут */
export function hasRecentCriticalErrors(minutes: number = 5): boolean {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const logs = getLogs();
  return logs.some((log) => log.type === 'error' && log.timestamp >= cutoff);
}