/**
 * AllDayRow — whole-day events for the selected day, shown above the hour axis.
 *
 * A `VALUE=DATE` event is stored as a UTC midnight marker, not an instant, so it
 * has no meaningful position on a clock. Before `is_all_day` existed these were
 * drawn as timed blocks at 00:00-03:00 in any timezone east of Greenwich.
 */

'use client';

import React from 'react';
import type { CalendarEvent } from '@/types/calendar';

interface AllDayRowProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
}

export function AllDayRow({ events, onEventClick }: AllDayRowProps) {
  if (events.length === 0) return null;

  return (
    <div
      className="border-b px-3 py-1.5 flex flex-col gap-1"
      style={{ borderColor: 'var(--color-border-white-subtle)' }}
    >
      {events.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => onEventClick?.(event)}
          className="w-full text-left rounded-sm px-2 py-1 truncate transition-opacity duration-fast active:opacity-70"
          style={{
            backgroundColor: 'var(--color-bg-surface)',
            borderLeft: '3px solid var(--color-signal-cyan)',
            fontSize: 'var(--text-body-sm)',
            color: 'var(--color-text-primary)',
          }}
          aria-label={`${event.title}, весь день`}
        >
          {event.title}
        </button>
      ))}
    </div>
  );
}
