/**
 * Calendar utilities — date grouping, formatting, etc.
 */

import type { CalendarEvent } from '@/types/calendar';

/**
 * Groups events by date string (YYYY-MM-DD).
 */
export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const dateKey = new Date(event.start_at).toISOString().split('T')[0];
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
 * Gets next N days starting from a date.
 */
export function getNextDays(startDate: Date, count: number): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(startDate);
    day.setDate(day.getDate() + i);
    days.push(day);
  }
  return days;
}

/**
 * Formats date header for agenda: "Сегодня, 18 июля" or "Завтра, 19 июля"
 */
export function formatDateGroupLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const dateStr = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });

  if (diffDays === 0) return `Сегодня, ${dateStr}`;
  if (diffDays === 1) return `Завтра, ${dateStr}`;
  if (diffDays === -1) return `Вчера, ${dateStr}`;
  return date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
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