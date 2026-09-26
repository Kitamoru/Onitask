/**
 * Calendar Module Types — onitask v0.14.0
 */

export type CalendarProvider = 'yandex';

/**
 * Calendar view mode for the TWA mobile interface.
 * - day: the selected day on a proportional time axis
 * - month: month grid for orientation, handing off to 'day' on a tap
 *
 * The single-day list and 3-day timeline modes existed as components but were
 * never wired up, and the height of a Telegram BottomSheet does not leave room
 * for a four-way switcher either.
 */
export type CalendarViewMode = 'day' | 'month';

export interface CalendarEvent {
  id: string;
  profile_id: string;
  provider: CalendarProvider;
  remote_event_id: string;
  title: string;
  description: string | null;
  start_at: string; // ISO 8601
  end_at: string;   // ISO 8601
  /** iCal VALUE=DATE: a whole date. start_at is a UTC midnight marker, not
   * an instant, so it must not be placed on the hourly axis. */
  is_all_day?: boolean;
  reminder_minutes_before: number | null;
  created_by: string | null;
  updated_by: string | null;
  source_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarConnection {
  id: string;
  profile_id: string;
  provider: CalendarProvider;
  provider_account_email: string;
  /** Palette slot identifying this account by colour. */
  color_index: number;
  token_expires_at: string | null;
  is_active: boolean;
  connected_at: string;
  last_sync_at: string | null;
  /**
   * Whether a CalDAV app password is stored. Yandex CalDAV rejects the OAuth
   * token, so without this the connection cannot sync (CAL-07/CAL-08).
   * The password itself never leaves the Edge Function (INV-17).
   */
  has_caldav_password?: boolean;
}

export interface CalendarSyncResponse {
  message: string;
  provider: CalendarProvider;
  synced: number;
  errors?: string[];
  error?: string;
  hint?: string;
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