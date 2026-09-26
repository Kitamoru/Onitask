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
import { localDateKey, isSameLocalDay, formatTimeShort } from '@/lib/calendar';
import { OrbitLoader } from '@/components/shared/OrbitLoader';

/** Height of one hour row. 24 × this is the full axis height. */
const HOUR_HEIGHT = 44;
/** Keeps a short event tappable instead of collapsing to a sliver. */
const MIN_BLOCK_HEIGHT = 22;
/** Gap between the edge of the axis and a block. */
const BLOCK_INSET = 6;

interface DayViewProps {
  date: Date;
  /** Full event set; filtered to `date` here by local day key. */
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  /** Used by the empty state to jump to the nearest day that has something. */
  onDateSelect?: (date: Date) => void;
  isLoading?: boolean;
}

interface Positioned {
  event: CalendarEvent;
  startMinutes: number;
  endMinutes: number;
  /** Index of the overlap lane, and how many lanes the cluster uses. */
  lane: number;
  lanes: number;
}

/** Local minutes since midnight, clamped into the day. */
function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Assigns each event a lane so that overlapping events sit side by side
 * instead of on top of each other. Events are clustered: anything transitively
 * overlapping shares the lane count of its cluster.
 */
function layout(events: CalendarEvent[]): Positioned[] {
  const items = events
    .map((event) => {
      const startMinutes = minutesOfDay(event.start_at);
      const rawEnd = minutesOfDay(event.end_at);
      // A zero-length or inverted range still deserves a block.
      const endMinutes = rawEnd > startMinutes ? rawEnd : startMinutes + 30;
      return { event, startMinutes, endMinutes };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const positioned: Positioned[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMinutes);
      } else {
        laneEnds[lane] = item.endMinutes;
      }
      return { ...item, lane };
    });
    for (const item of assigned) {
      positioned.push({ ...item, lanes: laneEnds.length });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length > 0 && item.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flush();

  return positioned;
}

export function DayView({ date, events, onEventClick, onDateSelect, isLoading }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const dayEvents = useMemo(
    () => events.filter((e) => localDateKey(e.start_at) === localDateKey(date)),
    [events, date]
  );

  const positioned = useMemo(() => layout(dayEvents), [dayEvents]);
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

  // An empty day should still be useful rather than a blank grid: point at the
  // closest day that actually holds something. On a sparse calendar most days
  // are empty, and "nothing here" on its own reads as a broken screen.
  const nextPopulated = useMemo(() => {
    if (dayEvents.length > 0) return null;
    const key = localDateKey(date);
    const upcoming = events
      .filter((e) => localDateKey(e.start_at) >= key)
      .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    if (!upcoming) return null;
    const d = new Date(upcoming.start_at);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dayEvents.length, events, date]);

  const nextPopulatedCount = useMemo(() => {
    if (!nextPopulated) return 0;
    const key = localDateKey(nextPopulated);
    return events.filter((e) => localDateKey(e.start_at) === key).length;
  }, [nextPopulated, events]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <OrbitLoader size={32} />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
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
                    borderLeft: '3px solid var(--color-signal-yellow)',
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

      {dayEvents.length === 0 && (
        <div
          className="absolute left-0 right-0 bottom-0 px-4 pb-4 pointer-events-none"
          aria-live="polite"
        >
          <div
            className="rounded-card px-3 py-2.5 pointer-events-auto"
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-white-subtle)',
            }}
          >
            <p className="text-body-sm" style={{ color: 'var(--color-text-primary)' }}>
              {isToday
                ? 'Сегодня ничего не запланировано'
                : 'В этот день ничего не запланировано'}
            </p>

            {nextPopulated && onDateSelect && (
              <button
                type="button"
                onClick={() => onDateSelect(nextPopulated)}
                className="mt-1 text-body-sm font-medium text-left transition-opacity duration-fast active:opacity-70"
                style={{ color: 'var(--color-accent-amber)' }}
              >
                Ближайшее:{' '}
                {nextPopulated.toLocaleDateString('ru-RU', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                })}{' '}
                · {nextPopulatedCount} событий
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
