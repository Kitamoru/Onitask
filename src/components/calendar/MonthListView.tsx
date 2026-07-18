/**
 * MonthListView — iPhone-style calendar month view
 * 
 * Shows compact month grid (7 columns, vertical scroll)
 * Click any day → triggers onDateSelect, parent switches to 'day' tab
 * No internal drill-down — navigation handled by parent page
 */

'use client';

import React, { useMemo, useState, useEffect } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { groupEventsByDate } from '@/lib/calendar';

interface MonthListViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  isLoading?: boolean;
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function getProviderColor(provider: CalendarEvent['provider']): string {
  return provider === 'yandex' ? '#F59E0B' : '#06B6D4';
}

function getMonthGrid(date: Date): { day: Date; currentMonth: boolean }[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const days: { day: Date; currentMonth: boolean }[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({ day: new Date(year, month - 1, prevMonthLastDay - i), currentMonth: false });
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: new Date(year, month, d), currentMonth: true });
  }

  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({ day: new Date(year, month + 1, d), currentMonth: false });
  }

  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

// ═══════════════════════════════════════════
// Month Grid Cell
// ═══════════════════════════════════════════

function MonthCell({ day, currentMonth, isSelected, dayEvents, onClick }: {
  day: Date; currentMonth: boolean; isSelected: boolean; dayEvents: CalendarEvent[]; onClick: () => void;
}) {
  const today = isToday(day);
  const hasEvents = dayEvents.length > 0;
  const maxShow = 3;

  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center py-1 relative"
      style={{ width: '14.28%', cursor: currentMonth ? 'pointer' : 'default', opacity: currentMonth ? 1 : 0.3,
        backgroundColor: isSelected ? 'var(--tg-theme-button-color, var(--color-accent-amber))' : 'transparent',
        borderRadius: '8px', transition: 'all 0.15s ease', transform: isSelected || today ? 'scale(1.02)' : 'scale(1)' }}>
      <span className="text-body-sm font-medium leading-none"
        style={{ color: isSelected ? 'var(--tg-theme-button-text-color, var(--color-text-white))'
          : today ? 'var(--tg-theme-button-color, var(--color-accent-amber))'
          : currentMonth ? 'var(--tg-theme-text-color, var(--color-text-primary))' : 'var(--tg-theme-hint-color, var(--color-text-muted))',
          fontWeight: isSelected || today ? 600 : 400 }}>{day.getDate()}</span>
      {hasEvents && currentMonth && (
        <div className="mt-0.5 flex flex-wrap justify-center gap-0.3">
          {dayEvents.slice(0, maxShow).map((ev: CalendarEvent, i: number) => (
            <span key={i} className="rounded-full" style={{ width: '4px', height: '4px', backgroundColor: getProviderColor(ev.provider) }} />
          ))}
          {dayEvents.length > maxShow && (
            <span className="text-[7px] leading-none" style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}>+{dayEvents.length - maxShow}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════
// Month View (scrollable month grid with prev/next nav)
// ═══════════════════════════════════════════

export function MonthListView({ events, selectedDate, onDateSelect, isLoading }: MonthListViewProps) {
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(selectedDate));

  // Update viewMonth when selectedDate changes externally
  useEffect(() => { setViewMonth(new Date(selectedDate)); }, [selectedDate]);

  const gridDays = useMemo(() => getMonthGrid(viewMonth), [viewMonth]);
  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);
  const monthLabel = `${MONTH_LABELS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  // Navigate months
  const goPrev = () => { const d = new Date(viewMonth); d.setMonth(d.getMonth() - 1); setViewMonth(d); };
  const goNext = () => { const d = new Date(viewMonth); d.setMonth(d.getMonth() + 1); setViewMonth(d); };

  // Select day → notify parent (parent switches to 'day' tab)
  const handleDayClick = (date: Date) => {
    setViewMonth(new Date(date));
    onDateSelect(date);
  };

  return (
    <div className="flex flex-col h-full overflow-x-hidden" style={{ width: '100%', boxSizing: 'border-box', alignSelf: 'stretch' }}>
      {/* Month header with nav arrows */}
      <div className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--tg-theme-border-color, var(--color-border-default))' }}>
        <button onClick={goPrev}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-fast active:scale-95 hover:bg-surface-hover" aria-label="Предыдущий месяц">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="var(--tg-theme-text-color, var(--color-text-primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="text-heading-sm font-semibold" style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}>{monthLabel}</span>
        <button onClick={goNext}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-fast active:scale-95 hover:bg-surface-hover" aria-label="Следующий месяц">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="var(--tg-theme-text-color, var(--color-text-primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="flex px-1 border-b" style={{ borderColor: 'var(--tg-theme-border-color, var(--color-border-default))' }}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="flex items-center justify-center py-2 text-body-xs font-medium"
            style={{ width: '14.28%', color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}>{label}</div>
        ))}
      </div>

      {/* Month grid rows */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        {Array.from({ length: 6 }, (_, rowIdx) => (
          <div key={rowIdx} className="flex border-b" style={{ borderColor: 'var(--tg-theme-border-color, var(--color-border-default))' }}>
            {gridDays.slice(rowIdx * 7, (rowIdx + 1) * 7).map((item, colIdx) => {
              const dateKey = item.day.toISOString().split('T')[0];
              const dayEvents = eventsByDate.get(dateKey) ?? [];
              const isSelected = item.currentMonth && isSameDay(item.day, selectedDate);
              return (
                <MonthCell key={`${rowIdx}-${colIdx}`} day={item.day} currentMonth={item.currentMonth}
                  isSelected={isSelected} dayEvents={dayEvents}
                  onClick={() => item.currentMonth && handleDayClick(item.day)} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}