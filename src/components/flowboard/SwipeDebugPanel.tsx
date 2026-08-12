'use client';

import { useEffect, useRef, useState } from 'react';
import { getRecentLogs, clearLogs, type SwipeLogEntry } from '@/lib/swipeLogger';

/**
 * SwipeDebugPanel — панель для просмотра логов свайпов прямо в приложении.
 * Полезно для отладки в Telegram Web App, где нет доступа к консоли.
 */

const LOG_FILTERS = ['all', 'error', 'warning', 'event', 'state'] as const;
type LogFilter = (typeof LOG_FILTERS)[number];

export function SwipeDebugPanel({ compact = false }: { compact?: boolean }) {
  const [logs, setLogs] = useState<SwipeLogEntry[]>(() => getRecentLogs(50));
  const [filter, setFilter] = useState<LogFilter>('all');
  const [isOpen, setIsOpen] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // Auto-refresh logs every 2 seconds when component is mounted
  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setLogs(getRecentLogs(50));
    }, 2000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.type === filter);

  const errorCount = logs.filter((l) => l.type === 'error').length;
  const warningCount = logs.filter((l) => l.type === 'warning').length;

  const handleClear = () => {
    clearLogs();
    setLogs([]);
  };

  const getTypeColor = (type: SwipeLogEntry['type']): string => {
    switch (type) {
      case 'error':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'state':
        return '#3b82f6';
      case 'event':
        return '#10b981';
      default:
        return '#6b7280';
    }
  };

  const getTypeLabel = (type: SwipeLogEntry['type']): string => {
    switch (type) {
      case 'error':
        return 'ERROR';
      case 'warning':
        return 'WARN';
      case 'state':
        return 'STATE';
      case 'event':
        return 'EVENT';
      default:
        return type;
    }
  };

  if (compact) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-sm"
          aria-label="Отладка свайпов"
        >
          {/* Error badge */}
          {errorCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold">
              {errorCount}
            </span>
          )}
          {/* Warning badge */}
          {warningCount > 0 && errorCount === 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold">
              {warningCount}
            </span>
          )}
          <span>🐛 Debug</span>
        </button>

        {isOpen && (
          <DebugPanelContent
            logs={filteredLogs}
            allLogs={logs}
            filter={filter}
            setFilter={setFilter}
            getTypeColor={getTypeColor}
            getTypeLabel={getTypeLabel}
            onClear={handleClear}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-gray-900 text-white shadow-2xl">
        <DebugPanelContent
          logs={filteredLogs}
          allLogs={logs}
          filter={filter}
          setFilter={setFilter}
          getTypeColor={getTypeColor}
          getTypeLabel={getTypeLabel}
          onClear={handleClear}
        />
      </div>
    </div>
  );
}

function DebugPanelContent({
  logs,
  allLogs,
  filter,
  setFilter,
  getTypeColor,
  getTypeLabel,
  onClear,
}: {
  logs: SwipeLogEntry[];
  allLogs: SwipeLogEntry[];
  filter: LogFilter;
  setFilter: (f: LogFilter) => void;
  getTypeColor: (type: SwipeLogEntry['type']) => string;
  getTypeLabel: (type: SwipeLogEntry['type']) => string;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 p-4">
        <h2 className="text-lg font-semibold">🐛 Swipe Debug Logs</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{allLogs.length} записей</span>
          <button
            onClick={onClear}
            className="rounded bg-red-600 px-3 py-1 text-xs hover:bg-red-700"
          >
            Очистить
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 border-b border-gray-700 p-2">
        {LOG_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1 text-xs ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {f === 'all' ? 'Все' : getTypeLabel(f as SwipeLogEntry['type'])}
          </button>
        ))}
      </div>

      {/* Log list */}
      <div className="max-h-96 overflow-y-auto p-2">
        {logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            Нет записей
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded bg-gray-800/80 p-2 text-xs"
                style={{
                  borderLeft: `3px solid ${getTypeColor(log.type)}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-gray-500">
                    {new Date(log.timestamp).toLocaleTimeString('ru-RU')}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 font-bold text-white"
                    style={{ backgroundColor: getTypeColor(log.type) }}
                  >
                    {getTypeLabel(log.type)}
                  </span>
                  {log.component && (
                    <span className="text-gray-400">{log.component}</span>
                  )}
                </div>
                <div className="mt-1 text-gray-200">{log.message}</div>
                {log.data && Object.keys(log.data).length > 0 && (
                  <pre className="mt-1 max-h-20 overflow-y-auto rounded bg-gray-900 p-1.5 text-[10px] text-gray-400">
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}