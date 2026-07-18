/**
 * ListView — Infinite vertical scroll of all upcoming events
 * 
 * Grouped by date headers: "Сегодня, 18 июля", "Завтра, 19 июля", etc.
 * Mobile-first, 100vw responsive for Telegram TWA
 */

'use client';

import React, { useMemo } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { formatDateGroupLabel, formatTimeShort } from '@/lib/calendar';

interface ListViewProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  isLoading?: boolean;
}

export function ListView({
  events,
  onEventClick,
  isLoading,
}: ListViewProps) {
  const groupedEvents = useMemo(() => {
    // Sort events by start_at ascending
    const sorted = [...events].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );

    // Group by date
    const groups: Map<string, CalendarEvent[]> = new Map();
    let currentGroupKey = '';

    for (const event of sorted) {
      const dateKey = new Date(event.start_at).toISOString().split('T')[0];
      if (dateKey !== currentGroupKey) {
        groups.set(dateKey, []);
        currentGroupKey = dateKey;
      }
      groups.get(dateKey)?.push(event);
    }

    return groups;
  }, [events]);

  const groupEntries = useMemo(
    () => Array.from(groupedEvents.entries()).sort(([a], [b]) => a.localeCompare(b)),
    [groupedEvents]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span
          className="text-body-sm"
          style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
        >
          Загрузка событий...
        </span>
      </div>
    );
  }

  if (groupEntries.length === 0) {
    return (
      <div
        className="
          flex flex-col items-center justify-center
          py-12 px-4
          text-center
        "
      >
        <span className="text-4xl mb-3">📋</span>
        <p
          className="text-body-sm font-medium"
          style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
        >
          Нет предстоящих событий
        </p>
        <p
          className="text-body-xs mt-1"
          style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
        >
          События появятся здесь после синхронизации
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      {groupEntries.map(([dateKey, groupEvents]) => {
        const groupDate = new Date(dateKey + 'T00:00:00');

        return (
          <div key={dateKey}>
            {/* Date group header */}
            <div
              className="
                px-3 py-2 sticky top-0 z-10
                border-b
              "
              style={{
                backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-dark))',
                borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
              }}
            >
              <span
                className="text-body-sm font-semibold"
                style={{
                  color: 'var(--tg-theme-text-color, var(--color-text-primary))',
                }}
              >
                {formatDateGroupLabel(groupDate)}
              </span>
              <span
                className="text-body-xs ml-2"
                style={{
                  color: 'var(--tg-theme-hint-color, var(--color-text-muted))',
                }}
              >
                {groupEvents.length} {getEventCountWord(groupEvents.length)}
              </span>
            </div>

            {/* Events in group */}
            <div className="px-2 mt-1 space-y-1">
              {groupEvents.map((event: CalendarEvent) => (
                <button
                  key={event.id}
                  onClick={() => onEventClick?.(event)}
                  className="
                    w-full text-left rounded-md px-3 py-2.5
                    transition-all duration-fast
                    active:scale-[0.98]
                    hover:bg-surface-hover
                  "
                  style={{
                    backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
                    borderLeft: `3px solid ${getProviderColor(event.provider)}`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    {/* Time column */}
                    <div className="flex flex-col shrink-0 min-w-[3rem]">
                      <span
                        className="text-body-sm font-semibold"
                        style={{
                          color: 'var(--tg-theme-text-color, var(--color-text-primary))',
                        }}
                      >
                        {formatTimeShort(event.start_at)}
                      </span>
                      <span
                        className="text-body-xs"
                        style={{
                          color: 'var(--tg-theme-hint-color, var(--color-text-muted))',
                        }}
                      >
                        → {formatTimeShort(event.end_at)}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-body-sm font-medium truncate"
                        style={{
                          color: 'var(--tg-theme-text-color, var(--color-text-primary))',
                        }}
                      >
                        {event.title}
                      </p>
                      {event.description && (
                        <p
                          className="text-body-xs truncate mt-0.5"
                          style={{
                            color: 'var(--tg-theme-hint-color, var(--color-text-muted))',
                          }}
                        >
                          {event.description}
                        </p>
                      )}
                    </div>

                    {/* Provider badge */}
                    <span
                      className="
                        shrink-0 inline-flex items-center justify-center
                        rounded-xs px-1 py-0.5
                      "
                      style={{
                        backgroundColor: `${getProviderColor(event.provider)}20`,
                        color: getProviderColor(event.provider),
                        fontSize: 'var(--text-body-xs)',
                        fontWeight: 'var(--font-weight-medium)',
                      }}
                    >
                      {event.provider === 'yandex' ? 'Я' : 'O'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getProviderColor(provider: CalendarEvent['provider']): string {
  return provider === 'yandex'
    ? 'var(--color-signal-yellow)'
    : 'var(--color-signal-cyan)';
}

function getEventCountWord(count: number): string {
  const abs = Math.abs(count) % 100;
  const lastDigit = abs % 10;
  if (abs > 10 && abs < 20) return 'событий';
  if (lastDigit > 1 && lastDigit < 5) return 'события';
  if (lastDigit === 1) return 'событие';
  return 'событий';
}