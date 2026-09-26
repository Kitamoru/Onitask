/**
 * Calendar Module — Components Index
 *
 * Mobile-first calendar components for the Telegram TWA. The Mini App runs
 * inside a draggable BottomSheet, so the screen is two views on one scale —
 * a day and the month it sits in — rather than a four-way switcher.
 */

export { CalendarTabs } from './CalendarTabs';
export { WeekStrip } from './WeekStrip';
export { DayView } from './DayView';
export { AllDayRow } from './AllDayRow';
export { MonthView } from './MonthView';
export { EventDetailSheet } from './EventDetailSheet';

// Re-export types
export type { CalendarViewMode } from '@/types/calendar';
