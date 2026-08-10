/**
 * Date formatting utilities for sprint components.
 */

/** Родительный падеж названий месяцев для формата "день месяц год" */
const MONTH_GENITIVE_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Formats a date as "день месяц год", e.g. "10 августа 2026".
 */
export function formatDateLong(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_GENITIVE_RU[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Formats a date as "DD.MM.YYYY".
 */
export function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Formats a date range as "DD.MM.YYYY – DD.MM.YYYY".
 * Returns placeholder if either date is missing.
 */
export function formatDateRange(
  startDate: Date | string | null,
  endDate: Date | string | null,
): string {
  if (!startDate || !endDate) return '';
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

/**
 * Converts a Date to ISO date string (YYYY-MM-DD) for API.
 */
export function toISODate(date: Date | null): string | null {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses an ISO date string (YYYY-MM-DD) into a Date object.
 */
export function fromISODate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Computes days left until the end date (inclusive).
 * Returns 0 if the end date has passed.
 */
export function computeDaysLeft(endDate: Date | string | null): number {
  if (!endDate) return 0;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
  if (isNaN(end.getTime())) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/**
 * Returns true if two dates represent the same calendar day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Returns true if `day` falls strictly between `start` and `end`
 * (not inclusive of either endpoint).
 */
export function isBetween(day: Date, start: Date, end: Date): boolean {
  const t = stripTime(day).getTime();
  return t > stripTime(start).getTime() && t < stripTime(end).getTime();
}

/**
 * Strips the time portion from a Date, leaving only year/month/day.
 */
export function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Returns a new Date shifted by `delta` months.
 */
export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/**
 * Returns a new Date shifted by `delta` days.
 */
export function addDays(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/**
 * Formats a Date as "Month YYYY" in Russian, e.g. "Май 2026".
 */
export function monthLabel(date: Date): string {
  return `${MONTH_NAMES_RU[date.getMonth()]} ${date.getFullYear()}`;
}

// Monday-first weekday labels matching Russian calendar convention.
export const WEEKDAY_LABELS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Builds a 7-column grid for `monthDate`, Monday-first, padded with
 * trailing days from the previous month and leading days from the next
 * month so every row has exactly 7 cells.
 */
export function getMonthGrid(monthDate: Date): { date: Date; inMonth: boolean }[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  // JS getDay(): 0=Sunday..6=Saturday. Convert to Monday-first offset.
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = lastOfMonth.getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];

  for (let i = firstWeekday; i > 0; i--) {
    cells.push({ date: new Date(year, month, 1 - i), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: addDays(last, 1), inMonth: false });
  }

  return cells;
}
