/**
 * ThreeDaysView — Horizontal 2-day compact grid
 * 
 * Mobile-first, matches /boards TWA layout (maxWidth 390px, padding 16px)
 * Layout: shared timeline with time labels + two day columns side by side
 * Single scroll container for all columns — no independent scrolling per day
 * Selected day uses subtle highlight (no bright border).
 * Today indicator: amber circle around date number.
 */

'use client';

import React, { useMemo } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { getNextDays, formatTimeShort } from '@/lib/calendar';

interface ThreeDaysViewProps {
  selectedDate: Date;
  events: CalendarEvent[];
  onDateSelect?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  isLoading?: boolean;
}

export function ThreeDaysView({
  selectedDate,
  events,
  onDateSelect,
  onEventClick,
  isLoading,
}: ThreeDaysViewProps) {
  const days = useMemo(() => getNextDays(selectedDate, 2), [selectedDate]);

  const todayKey = new Date().toISOString().split('T')[0];

  // Group all events by date key
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days) {
      const key = day.toISOString().split('T')[0];
      map.set(key, []);
    }
    for (const event of events) {
      const key = new Date(event.start_at).toISOString().split('T')[0];
      const existing = map.get(key);
      if (existing) {
        existing.push(event);
      }
    }
    return map;
  }, [events, days]);

  // Pre-compute events by hour for each day (moved out of JSX)
  const eventsByHourMap = useMemo(() => {
    const result = new Map<string, Record<number, CalendarEvent[]>>();
    for (const day of days) {
      const key = day.toISOString().split('T')[0];
      const byHour: Record<number, CalendarEvent[]> = {};
      const dayEvents = eventsByDate.get(key) ?? [];
      for (const event of dayEvents) {
        const startHour = new Date(event.start_at).getHours();
        if (!byHour[startHour]) byHour[startHour] = [];
        byHour[startHour].push(event);
      }
      result.set(key, byHour);
    }
    return result;
  }, [days, eventsByDate]);

  // Format header dates — abbreviated weekday + date number
  const day1Weekday = days[0].toLocaleDateString('ru-RU', { weekday: 'short' });
  const day1Num = days[0].getDate();
  const day2Weekday = days[1].toLocaleDateString('ru-RU', { weekday: 'short' });
  const day2Num = days[1].getDate();

  return (
    <div
      className="flex flex-col"
      style={{
        height: '100%',
        minHeight: '400px',
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Header — one-line compact date blocks above each day column */}
      <div
        className="flex border-b"
        style={{
          backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-dark))',
          borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
        }}
      >
        {/* Spacer for time column */}
        <div style={{ width: '48px', flexShrink: 0 }} />
        {/* Day 1 header */}
        <div
          className="flex items-center justify-center gap-1 px-1 flex-1 border-l"
          style={{ height: '36px', borderColor: 'var(--tg-theme-border-color, var(--color-border-default))' }}
        >
          <span
            className="text-[11px] font-medium leading-none shrink-0"
            style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
          >
            {day1Weekday}
          </span>
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold leading-none shrink-0"
            style={{
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: 'var(--tg-theme-link-color, var(--color-accent-amber))',
            }}
          >
            {day1Num}
          </span>
        </div>
        {/* Day 2 header */}
        <div
          className="flex items-center justify-center gap-1 px-1 flex-1 border-l"
          style={{ height: '36px', borderColor: 'var(--tg-theme-border-color, var(--color-border-default))' }}
        >
          <span
            className="text-[11px] font-medium leading-none shrink-0"
            style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
          >
            {day2Weekday}
          </span>
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold leading-none shrink-0"
            style={{
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: 'var(--tg-theme-link-color, var(--color-accent-amber))',
            }}
          >
            {day2Num}
          </span>
        </div>
      </div>

      {/* Shared scrollable timeline: time labels + two day columns */}
      <div className="flex flex-1 overflow-y-auto" style={{ minWidth: 0 }}>
        {/* Time labels column */}
        <div
          className="shrink-0"
          style={{ width: '44px', flexShrink: 0 }}
        >
          {Array.from({ length: 24 }, (_, hour) => {
            const isNow = hour === new Date().getHours();
            return (
              <div
                key={`time-${hour}`}
                className="flex items-start justify-end pr-1"
                style={{
                  height: '3rem',
                  borderBottom: '1px solid var(--tg-theme-border-color, var(--color-border-default))',
                  color: isNow
                    ? 'var(--tg-theme-link-color, var(--color-accent-amber))'
                    : 'var(--tg-theme-hint-color, var(--color-text-muted))',
                  fontWeight: isNow ? '600' : '400',
                }}
              >
                <span className="text-[10px] leading-tight">{String(hour).padStart(2, '0')}:00</span>
              </div>
            );
          })}
        </div>

        {/* Day 1 column */}
        {(() => {
          const day1 = days[0];
          const dateKey1 = day1.toISOString().split('T')[0];
          const isSelected1 = dateKey1 === selectedDate.toISOString().split('T')[0];
          const eventsByHour1 = eventsByHourMap.get(dateKey1) ?? {};

          return (
            <div
              className="flex-1 border-l min-w-0"
              style={{
                borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
                backgroundColor: isSelected1 ? 'rgba(245, 158, 11, 0.04)' : 'transparent',
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => {
                const hourEvents = eventsByHour1[hour] ?? [];
                const isNow = hour === new Date().getHours();

                return (
                  <div
                    key={`d1-${hour}`}
                    className="flex border-b transition-colors duration-fast"
                    style={{
                      borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
                      backgroundColor: isNow ? 'rgba(245, 158, 11, 0.06)' : 'transparent',
                      minHeight: hourEvents.length > 0 ? 'auto' : '3rem',
                      height: '3rem',
                    }}
                  >
                    <div className="flex-1 py-1 pr-2 space-y-1">
                      {hourEvents.length === 0 && (
                        <span
                          className="text-body-xs italic opacity-30"
                          style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
                        >
                          свободно
                        </span>
                      )}
                      {hourEvents.map((event: CalendarEvent) => (
                        <button
                          key={event.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick?.(event);
                          }}
                          className="w-full text-left rounded-md px-2.5 py-1.5 transition-all duration-fast active:scale-[0.98] hover:bg-surface-hover"
                          style={{
                            backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
                            borderLeft: `3px solid ${getProviderColor(event.provider)}`,
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-body-xs font-medium truncate"
                              style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
                            >
                              {formatTimeShort(event.start_at)} – {formatTimeShort(event.end_at)}
                            </span>
                          </div>
                          <p
                            className="text-body-sm font-medium mt-0.5 truncate"
                            style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
                          >
                            {event.title}
                          </p>
                          {event.description && (
                            <p
                              className="text-body-xs truncate mt-0.5"
                              style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
                            >
                              {event.description}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Day 2 column */}
        {(() => {
          const day2 = days[1];
          const dateKey2 = day2.toISOString().split('T')[0];
          const isSelected2 = dateKey2 === selectedDate.toISOString().split('T')[0];
          const eventsByHour2 = eventsByHourMap.get(dateKey2) ?? {};

          return (
            <div
              className="flex-1 border-l min-w-0"
              style={{
                borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
                backgroundColor: isSelected2 ? 'rgba(245, 158, 11, 0.04)' : 'transparent',
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => {
                const hourEvents = eventsByHour2[hour] ?? [];
                const isNow = hour === new Date().getHours();

                return (
                  <div
                    key={`d2-${hour}`}
                    className="flex border-b transition-colors duration-fast"
                    style={{
                      borderColor: 'var(--tg-theme-border-color, var(--color-border-default))',
                      backgroundColor: isNow ? 'rgba(245, 158, 11, 0.06)' : 'transparent',
                      minHeight: hourEvents.length > 0 ? 'auto' : '3rem',
                      height: '3rem',
                    }}
                  >
                    <div className="flex-1 py-1 pr-2 space-y-1">
                      {hourEvents.length === 0 && (
                        <span
                          className="text-body-xs italic opacity-30"
                          style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
                        >
                          свободно
                        </span>
                      )}
                      {hourEvents.map((event: CalendarEvent) => (
                        <button
                          key={event.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick?.(event);
                          }}
                          className="w-full text-left rounded-md px-2.5 py-1.5 transition-all duration-fast active:scale-[0.98] hover:bg-surface-hover"
                          style={{
                            backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
                            borderLeft: `3px solid ${getProviderColor(event.provider)}`,
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-body-xs font-medium truncate"
                              style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
                            >
                              {formatTimeShort(event.start_at)} – {formatTimeShort(event.end_at)}
                            </span>
                          </div>
                          <p
                            className="text-body-sm font-medium mt-0.5 truncate"
                            style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
                          >
                            {event.title}
                          </p>
                          {event.description && (
                            <p
                              className="text-body-xs truncate mt-0.5"
                              style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
                            >
                              {event.description}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function getProviderColor(provider: CalendarEvent['provider']): string {
  return provider === 'yandex' ? 'var(--color-signal-yellow)' : 'var(--color-signal-cyan)';
}