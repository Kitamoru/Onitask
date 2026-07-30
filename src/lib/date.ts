/**
 * Date formatting utilities for sprint components.
 */

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