/**
 * Calendar Module Types — onitask v0.14.0
 */

export type CalendarProvider = 'yandex' | 'outlook';

/**
 * Calendar view mode for the TWA mobile interface.
 * - month-list: Month grid + agenda list below (default)
 * - day: Single day detail view with hourly breakdown
 * - three-days: Horizontal 3-day compact grid
 * - list: Infinite vertical scroll of all upcoming events
 */
export type CalendarViewMode = 'month-list' | 'day' | 'three-days' | 'list';

export interface CalendarEvent {
  id: string;
  workspace_id: string;
  provider: CalendarProvider;
  remote_event_id: string;
  title: string;
  description: string | null;
  start_at: string; // ISO 8601
  end_at: string;   // ISO 8601
  reminder_minutes_before: number | null;
  created_by: string | null;
  updated_by: string | null;
  source_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarConnection {
  id: string;
  workspace_id: string;
  worker_id: string;
  provider: CalendarProvider;
  provider_account_email: string;
  token_expires_at: string | null;
  is_active: boolean;
  connected_at: string;
  last_sync_at: string | null;
}

export interface CalendarSyncResponse {
  message: string;
  provider: CalendarProvider;
  synced: number;
  errors?: string[];
}

export interface CalendarReminderJob {
  id: string;
  workspace_id: string;
  payload: {
    workspace_id: string;
    alert_type: 'calendar_reminder';
    event_id: string;
    target_worker_id: string;
  };
}

// React-Day-Picker compatible types
export type DayPickerModifiers = Record<string, boolean>;

export interface CalendarDayData {
  date: Date;
  events: CalendarEvent[];
  eventCount: number;
}