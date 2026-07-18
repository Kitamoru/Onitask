/**
 * DayView — Single day detail view with hourly breakdown
 * 
 * Mobile-first, 100vw responsive for Telegram TWA
 * Includes back arrow to return to month view
 */

'use client';

import React, { useMemo } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { formatTimeShort } from '@/lib/calendar';

interface DayViewProps {
  selectedDate: Date;
  events: CalendarEvent[];
  onBack?: () => void;
  onEventClick?: (event: CalendarEvent) => void;
  isLoading?: boolean;
}

export function DayView({
  selectedDate,
  events,
  onBack,
  onEventClick,
  isLoading,
}: DayViewProps) {
  const eventsByHour = useMemo(() => {
    const byHour: Record<number, CalendarEvent[]> = {};
    for (const event of events) {
      const startHour = new Date(event.start_at).getHours();
      if (!byHour[startHour]) byHour[startHour] = [];
      byHour[startHour].push(event);
    }
    return byHour;
  }, [events]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const dateLabel = selectedDate.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '400px' }}>
      {/* Back button + date header */}
      <div
        className="flex items-center gap-2 px-3 py-3 sticky top-0 z-10 border-b"
        style={{
          backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-dark))',
          borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
        }}
      >
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-fast active:scale-95 hover:bg-surface-hover"
            aria-label="Назад к месяцу"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="var(--tg-theme-text-color, var(--color-text-primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <h2
          className="text-body-sm font-semibold capitalize"
          style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
        >
          {dateLabel}
        </h2>
      </div>

      {/* Hourly timeline */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-body-sm" style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}>Загрузка...</span>
          </div>
        ) : (
          hours.map((hour) => {
            const hourEvents = eventsByHour[hour] ?? [];
            const isNow = hour === new Date().getHours();
            return (
              <div
                key={hour}
                className="flex border-b transition-colors duration-fast"
                style={{
                  borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
                  backgroundColor: isNow ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                  minHeight: hourEvents.length > 0 ? 'auto' : '3rem',
                }}
              >
                {/* Time label */}
                <div
                  className="w-14 shrink-0 text-right pr-2 pt-2 text-body-xs"
                  style={{
                    color: isNow ? 'var(--tg-theme-link-color, var(--color-accent-amber))' : 'var(--tg-theme-hint-color, var(--color-text-muted))',
                    fontWeight: isNow ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
                  }}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>

                {/* Events column */}
                <div className="flex-1 py-1 pr-2 space-y-1">
                  {hourEvents.length === 0 && (
                    <span className="text-body-xs italic opacity-40" style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}>свободно</span>
                  )}
                  {hourEvents.map((event: CalendarEvent) => (
                    <button
                      key={event.id}
                      onClick={() => onEventClick?.(event)}
                      className="w-full text-left rounded-md px-2.5 py-1.5 transition-all duration-fast active:scale-[0.98] hover:bg-surface-hover"
                      style={{
                        backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
                        borderLeft: `3px solid ${getProviderColor(event.provider)}`,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-body-xs font-medium truncate" style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}>
                          {formatTimeShort(event.start_at)} – {formatTimeShort(event.end_at)}
                        </span>
                      </div>
                      <p className="text-body-sm font-medium mt-0.5 truncate" style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}>{event.title}</p>
                      {event.description && (
                        <p className="text-body-xs truncate mt-0.5" style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}>{event.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function getProviderColor(provider: CalendarEvent['provider']): string {
  return provider === 'yandex' ? 'var(--color-signal-yellow)' : 'var(--color-signal-cyan)';
}