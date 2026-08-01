'use client';

import { cn } from '@/lib/cn';
import {
  getMonthGrid,
  isSameDay,
  isBetween,
  stripTime,
  WEEKDAY_LABELS_RU,
} from '@/lib/date';

export function Calendar({
  monthDate,
  rangeStart,
  rangeEnd,
  onDayClick,
  minDate,
}: {
  /** Any date within the month to display. */
  monthDate: Date;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  onDayClick: (day: Date) => void;
  /** Days before this are shown but not selectable — greys them out
   *  instead of hiding them, so the grid shape doesn't jump around. */
  minDate?: Date;
}) {
  const cells = getMonthGrid(monthDate);
  const today = stripTime(new Date());

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-y-1">
        {WEEKDAY_LABELS_RU.map((label) => (
          <div
            key={label}
            className="flex h-8 items-center justify-center text-[12px] text-text-faint"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map(({ date, inMonth }, i) => {
          const disabled = minDate ? date < stripTime(minDate) : false;
          const isStart = rangeStart && isSameDay(date, rangeStart);
          const isEnd = rangeEnd && isSameDay(date, rangeEnd);
          const inRange =
            rangeStart && rangeEnd && isBetween(date, rangeStart, rangeEnd);
          const isToday = isSameDay(date, today);
          const isEdge = isStart || isEnd;

          const isInRange = inRange && !isEdge;

          return (
            <div
              key={i}
              className={cn(
                'relative flex h-10 items-center justify-center',
                // Green squares fill the whole in-range band — start/end
                // are solid green edge cells, middle cells get the tint.
                inRange && 'bg-success',
                isStart && rangeEnd && 'rounded-l-md bg-success',
                isEnd && rangeStart && !isSameDay(rangeStart, rangeEnd) && 'rounded-r-md bg-success'
              )}
            >
              <button
                type="button"
                disabled={disabled || !inMonth}
                onClick={() => onDayClick(date)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center text-[14px] transition-colors',
                  !inMonth && 'invisible',
                  disabled && 'text-text-faint opacity-40',
                  'rounded-md',
                  !disabled && inMonth && !isEdge && !isInRange && 'text-text',
                  isInRange && 'bg-success/25 text-white',
                  !disabled && isToday && !isEdge && !isInRange && 'border border-line',
                  isEdge && 'bg-success font-semibold text-accent-ink'
                )}
              >
                {date.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}