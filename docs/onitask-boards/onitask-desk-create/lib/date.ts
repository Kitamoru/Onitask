/**
 * Small, dependency-free date helpers for the sprint date-range picker.
 * Deliberately not pulling in date-fns/dayjs — everything needed here is
 * a handful of plain Date arithmetic + one fixed display format
 * (DD.MM.YYYY, per the "19.05.2026 — 26.05.2026" reference mockup), and
 * this project has otherwise stayed dependency-light throughout.
 */

export function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return "";
  if (start && !end) return formatDate(start);
  if (start && end) return `${formatDate(start)} — ${formatDate(end)}`;
  return "";
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isBetween(day: Date, start: Date, end: Date): boolean {
  const t = stripTime(day).getTime();
  return t > stripTime(start).getTime() && t < stripTime(end).getTime();
}

export function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function addDays(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

const MONTH_NAMES_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function monthLabel(date: Date): string {
  return `${MONTH_NAMES_RU[date.getMonth()]} ${date.getFullYear()}`;
}

// Monday-first week, matching Russian calendar convention.
const WEEKDAY_LABELS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export { WEEKDAY_LABELS_RU };

/**
 * Full calendar grid for a given month, Monday-first, padded with the
 * trailing days of the previous month and leading days of the next
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
