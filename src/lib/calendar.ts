/**
 * Calendar utilities — date grouping, formatting, etc.
 */

import type { CalendarEvent } from '@/types/calendar';

/**
 * YYYY-MM-DD in the viewer's own timezone.
 *
 * Deliberately not `toISOString().split('T')[0]` — that is the UTC date, which
 * files a 01:00 event under the previous day for anyone east of Greenwich,
 * i.e. for every user of this app. The day an event belongs to is a local
 * question, so it has to be asked with local getters.
 */
export function localDateKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * True when both dates fall on the same calendar day in local time.
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return localDateKey(a) === localDateKey(b);
}

/**
 * Groups events by local date string (YYYY-MM-DD).
 */
export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const dateKey = localDateKey(event.start_at);
    const existing = map.get(dateKey) ?? [];
    existing.push(event);
    map.set(dateKey, existing);
  }

  return map;
}

/**
 * Gets events for a specific date (YYYY-MM-DD).
 */
export function getEventsForDate(
  events: CalendarEvent[],
  dateKey: string
): CalendarEvent[] {
  return groupEventsByDate(events).get(dateKey) ?? [];
}

/**
 * Formats time from ISO string (HH:MM).
 */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Short time format (HH:MM without leading zero padding quirks).
 */
export function formatTimeShort(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}