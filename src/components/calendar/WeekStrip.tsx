/**
 * WeekStrip — iOS-style day-of-week strip shown above the day view.
 *
 * Its whole job is orientation: on a sparse calendar you need to see which
 * days actually hold something and jump there in one tap, which is cheaper
 * than scrolling a long agenda or paging the month grid.
 *
 * The strip is driven entirely by local dates — see `localDateKey` in
 * lib/calendar. Keying days in UTC would put a late-evening event on the
 * previous day and the dot would land next to the wrong number.
 */

'use client';

import React, { useMemo } from 'react';
import { localDateKey, isSameLocalDay } from '@/lib/calendar';

interface WeekStripProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  /** Local YYYY-MM-DD → number of events, used for the presence dots. */
  eventCounts: Map<string, number>;
}

/** Monday-first, matching the ru-RU week. */
const WEEKDAY_INITIALS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];

const WEEKDAY_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг',
  'Пятница', 'Суббота', 'Воскресенье',
];

/** Monday of the week containing `date`. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d;
}

function addDays(date: Date, count: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + count);
  return d;
}

export function WeekStrip({ selectedDate, onDateSelect, eventCounts }: WeekStripProps) {
  const days = useMemo(() => {
    const monday = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [selectedDate]);

  const weekStart = days[0];
  const weekEnd = days[6];
  const today = new Date();

  const monthSpan =
    weekStart.getMonth() === weekEnd.getMonth()
      ? weekStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      : `${weekStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${weekEnd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div
      className="border-b px-2 py-2"
      style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-bg-primary-dark)' }}
    >
      <div className="flex items-center justify-between mb-1 px-1">
        <button
          type="button"
          onClick={() => onDateSelect(addDays(weekStart, -7))}
          className="w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-fast active:scale-95"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Предыдущая неделя"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span
          className="text-body-sm font-semibold capitalize"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {monthSpan}
        </span>

        <button
          type="button"
          onClick={() => onDateSelect(addDays(weekEnd, 7))}
          className="w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-fast active:scale-95"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Следующая неделя"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" role="tablist" aria-label="Дни недели">
        {days.map((day, index) => {
          const isSelected = isSameLocalDay(day, selectedDate);
          const isToday = isSameLocalDay(day, today);
          const count = eventCounts.get(localDateKey(day)) ?? 0;

          return (
            <button
              key={day.toISOString()}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onDateSelect(day)}
              className="flex flex-col items-center gap-0.5 py-1 rounded-md transition-colors duration-fast active:scale-95"
              aria-label={`${WEEKDAY_FULL[index]}, ${day.getDate()}${
                count > 0 ? `, событий: ${count}` : ', событий нет'
              }`}
            >
              <span
                className="text-[10px] leading-none"
                style={{ color: isSelected ? 'var(--color-accent-amber)' : 'var(--color-text-muted)' }}
                aria-hidden="true"
              >
                {WEEKDAY_INITIALS[index]}
              </span>

              <span
                className="flex items-center justify-center text-body-sm font-semibold rounded-full"
                style={{
                  width: 28,
                  height: 28,
                  lineHeight: '28px',
                  backgroundColor: isSelected ? 'var(--color-accent-amber)' : 'transparent',
                  color: isSelected
                    ? 'var(--color-accent-ink)'
                    : isToday
                      ? 'var(--color-accent-amber)'
                      : 'var(--color-text-primary)',
                }}
              >
                {day.getDate()}
              </span>

              {/* Presence dot, not a colour cue alone: the count is in the label. */}
              <span
                aria-hidden="true"
                className="rounded-full"
                style={{
                  width: 4,
                  height: 4,
                  backgroundColor:
                    count > 0 ? 'var(--color-signal-yellow)' : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
