/**
 * DayView — one day on a proportional time axis.
 *
 * Events are positioned by their real start and duration rather than being
 * listed inside the hour they start in, so a 90-minute block occupies 90
 * minutes of the axis and two events can be read against each other. The
 * previous implementation dropped each event into its start hour with a fixed
 * padding, which made every event look equally long.
 *
 * The axis is the whole scroll container: 24 hours of a 44px hour is taller
 * than any phone, so the view opens scrolled to the part that matters — the
 * current time when viewing today, otherwise the first event of the day.
 */

'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import {
  localDateKey,
  isSameLocalDay,
  formatTimeShort,
  layoutDayEvents,
} from '@/lib/calendar';
import { AllDayRow } from '@/components/calendar/AllDayRow';
import { OrbitLoader } from '@/components/shared/OrbitLoader';

/** Height of one hour row. 24 × this is the full axis height. */
const HOUR_HEIGHT = 44;
/** Keeps a short event tappable instead of collapsing to a sliver. */
const MIN_BLOCK_HEIGHT = 22;
/** Scrollable slack below the 23:00 line so the last hour is fully reachable. */
const TAIL_PADDING = 28;
/** Gap between the edge of the axis and a block. */
const BLOCK_INSET = 6;

interface DayViewProps {
  date: Date;
  /** Full event set; filtered to `date` here by local day key. */
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  /** Colour for an event, resolved from the account it was synced from. */
  colorFor?: (event: CalendarEvent) => string;
  isLoading?: boolean;
}

export function DayView({ date, events, onEventClick, colorFor, isLoading }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // A row with no connection_id falls back to the neutral slot, not to the
  // provider's yellow. Yellow is close enough to slot 0 that unattributed events
  // read as the first account -- which is how a colour bug hid as a working one.
  const colorOf = colorFor ?? (() => 'var(--color-calendar-6)');

  const dayEvents = useMemo(
    () => events.filter((e) => localDateKey(e.start_at) === localDateKey(date)),
    [events, date]
  );

  // All-day events carry a UTC midnight marker rather than an instant, so they
  // are shown as a row above the axis instead of being placed on it.
  const { allDay, timed } = useMemo(
    () => ({
      allDay: dayEvents.filter((e) => e.is_all_day),
      timed: dayEvents.filter((e) => !e.is_all_day),
    }),
    [dayEvents]
  );

  const positioned = useMemo(() => layoutDayEvents(timed), [timed]);
  const isToday = isSameLocalDay(date, new Date());
  const now = new Date();

  // Open on the useful part of the axis rather than at midnight.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || isLoading) return;

    const focusMinutes = isToday
      ? now.getHours() * 60 + now.getMinutes()
      : positioned.length > 0
        ? positioned[0].startMinutes
        : 8 * 60;

    container.scrollTop = Math.max(0, (focusMinutes / 60) * HOUR_HEIGHT - HOUR_HEIGHT * 1.5);
  }, [date, isToday, isLoading, positioned.length]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <OrbitLoader size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <AllDayRow events={allDay} onEventClick={onEventClick} colorFor={colorOf} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="flex" style={{ height: 24 * HOUR_HEIGHT + TAIL_PADDING }}>
          {/* Hour labels */}
          <div className="w-12 shrink-0 relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ top: hour * HOUR_HEIGHT, color: 'var(--color-text-muted)' }}
                aria-hidden="true"
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Axis */}
          <div className="flex-1 relative" style={{ marginRight: BLOCK_INSET }}>
            {Array.from({ length: 25 }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0"
                style={{
                  top: i * HOUR_HEIGHT,
                  borderTop: `1px solid ${
                    i === 0 ? 'var(--color-border-default)' : 'var(--color-border-white-subtle)'
                  }`,
                }}
                aria-hidden="true"
              />
            ))}

            {/* Current time marker */}
            {isToday && (
              <div
                className="absolute left-0 right-0 flex items-center pointer-events-none"
                style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                aria-hidden="true"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full -ml-1"
                  style={{ backgroundColor: 'var(--color-signal-red)' }}
                />
                <span
                  className="flex-1"
                  style={{ borderTop: '1px solid var(--color-signal-red)' }}
                />
              </div>
            )}

            {positioned.map(({ event, startMinutes, endMinutes, lane, lanes }) => {
              const top = (startMinutes / 60) * HOUR_HEIGHT;
              const rawHeight = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;
              const height = Math.max(MIN_BLOCK_HEIGHT, rawHeight);
              const width = 100 / lanes;
              const isShort = rawHeight < 34;

              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onEventClick?.(event)}
                  className="absolute text-left rounded-md overflow-hidden transition-opacity duration-fast active:opacity-70"
                  style={{
                    top,
                    height,
                    left: `calc(${lane * width}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    backgroundColor: 'var(--color-bg-surface)',
                    borderLeft: '3px solid ' + colorOf(event),
                    padding: isShort ? '2px 6px' : '4px 6px',
                  }}
                  aria-label={`${event.title}, ${formatTimeShort(event.start_at)} — ${formatTimeShort(event.end_at)}`}
                >
                  <span
                    className="block truncate font-medium"
                    style={{
                      fontSize: isShort ? 'var(--text-body-xs)' : 'var(--text-body-sm)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {event.title}
                  </span>
                  {height >= 34 && (
                    <span
                      className="block text-[10px] tabular-nums"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {formatTimeShort(event.start_at)} – {formatTimeShort(event.end_at)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
