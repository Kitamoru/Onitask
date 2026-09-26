/**
 * MonthView — month grid used for orientation.
 *
 * Its job is answering "is anything on that day, and where in time am I
 * looking" — not showing event titles. The cell is therefore a day number plus
 * presence dots and a count, and tapping a day hands off to the day view,
 * which is where the actual events are listed. That is why the dots are safe
 * here: nothing is hidden behind them, the day cell is one tap from the truth.
 *
 * The previous version (MonthListView) drew 4px dots with a 7px "+N" counter
 * and a hardcoded #F59E0B instead of the signal token.
 */

'use client';

import React, { useMemo } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { localDateKey, isSameLocalDay } from '@/lib/calendar';

interface MonthViewProps {
  /** Any date inside the month to display. */
  month: Date;
  onMonthChange: (month: Date) => void;
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  /** Full event set; counted per local day here. */
  events: CalendarEvent[];
}

const WEEKDAY_INITIALS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAY_FULL = [
  'понедельник', 'вторник', 'среда', 'четверг',
  'пятница', 'суббота', 'воскресенье',
];

const MAX_DOTS = 3;

/** 42 cells: six Monday-first weeks covering the month. */
function buildGrid(month: Date): { date: Date; inMonth: boolean }[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayIndex = (first.getDay() + 6) % 7;

  const cells: { date: Date; inMonth: boolean }[] = [];
  const start = new Date(first);
  start.setDate(start.getDate() - mondayIndex);

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    cells.push({ date, inMonth: date.getMonth() === month.getMonth() });
  }
  return cells;
}

export function MonthView({
  month,
  onMonthChange,
  selectedDate,
  onDateSelect,
  events,
}: MonthViewProps) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      const key = localDateKey(event.start_at);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const cells = useMemo(() => buildGrid(month), [month]);
  const today = new Date();

  const shiftMonth = (delta: number) =>
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  const label = `${MONTHS_GENITIVE[month.getMonth()]} ${month.getFullYear()}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-fast active:scale-95"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Предыдущий месяц"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span className="text-body-sm font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }}>
          {label}
        </span>

        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-fast active:scale-95"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Следующий месяц"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div
        className="grid grid-cols-7 px-1 pt-1"
        style={{ color: 'var(--color-text-muted)' }}
        aria-hidden="true"
      >
        {WEEKDAY_INITIALS.map((initial, index) => (
          <div key={initial} className="text-center text-[10px] font-medium py-1">
            {initial}
            <span className="sr-only">{WEEKDAY_FULL[index]}</span>
          </div>
        ))}
      </div>

      <div
        className="flex-1 min-h-0 grid grid-cols-7 grid-rows-6 px-1 pb-1"
        role="grid"
        aria-label={label}
      >
        {cells.map(({ date, inMonth }) => {
          const key = localDateKey(date);
          const count = counts.get(key) ?? 0;
          const isSelected = isSameLocalDay(date, selectedDate);
          const isToday = isSameLocalDay(date, today);
          const overflow = Math.max(0, count - MAX_DOTS);

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              onClick={() => onDateSelect(date)}
              className="flex flex-col items-center justify-start rounded-md py-0.5 transition-colors duration-fast active:scale-95"
              style={{
                opacity: inMonth ? 1 : 0.32,
                backgroundColor: isSelected ? 'var(--color-accent-amber)' : 'transparent',
              }}
              aria-label={`${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}, ${
                isToday ? 'сегодня, ' : ''
              }событий: ${count}`}
              aria-selected={isSelected}
            >
              <span
                className="flex items-center justify-center text-body-sm font-medium rounded-full"
                style={{
                  width: 26,
                  height: 26,
                  lineHeight: '26px',
                  color: isSelected
                    ? 'var(--color-accent-ink)'
                    : isToday
                      ? 'var(--color-accent-amber)'
                      : 'var(--color-text-primary)',
                  fontWeight: isSelected || isToday ? 600 : 400,
                }}
              >
                {date.getDate()}
              </span>

              <span className="flex items-center gap-[3px] h-3" aria-hidden="true">
                {count === 0 ? null : overflow > 0 ? (
                  <span className="text-[9px] leading-none" style={{ color: 'var(--color-text-muted)' }}>
                    {count}
                  </span>
                ) : (
                  Array.from({ length: count }, (_, i) => (
                    <span
                      key={i}
                      className="rounded-full"
                      style={{ width: 5, height: 5, backgroundColor: 'var(--color-signal-yellow)' }}
                    />
                  ))
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
