/**
 * Calendar Module API — onitask v0.14.0
 * Клиентские обёртки для календаря. Использует /api/calendar/data endpoint
 * с Telegram initData для аутентификации.
 */

import type {
  CalendarEvent,
  CalendarConnection,
  CalendarProvider,
} from '@/types/calendar';

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Calls /api/calendar/data with the given action and body.
 * Uses Telegram initData for authentication.
 */
async function callCalendarApi(
  action: string,
  body: Record<string, unknown>,
  initData?: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const response = await fetch('/api/calendar/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, action, init_data: initData }),
  });

  if (!response.ok) {
    return {
      success: false,
      error: `HTTP ${response.status}`,
    };
  }

  return response.json() as Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }>;
}

// ═══════════════════════════════════════════════════════
// Calendar Events CRUD
// ═══════════════════════════════════════════════════════

/**
 * Fetches all calendar events for a profile within a date range.
 */
export async function getCalendarEvents(
  profileId: string,
  options?: {
    initData?: string;
    startDate?: Date;
    endDate?: Date;
    provider?: CalendarProvider;
    limit?: number;
  }
): Promise<{ data: CalendarEvent[] | null; error: string | null }> {
  const { initData, startDate, endDate, provider, limit = 200 } = options ?? {};

  const result = await callCalendarApi('get_events', {
    profile_id: profileId,
    start_date: startDate?.toISOString(),
    end_date: endDate?.toISOString(),
    provider,
    limit,
  }, initData);

  if (!result.success) {
    return { data: null, error: result.error ?? 'Unknown error' };
  }

  return { data: (result.data ?? []) as CalendarEvent[], error: null };
}

/**
 * Creates or updates a calendar event manually.
 */
export async function upsertCalendarEvent(
  profileId: string,
  eventData: Omit<CalendarEvent, 'id' | 'profile_id' | 'created_at' | 'updated_at'>,
  initData?: string
): Promise<{ data: CalendarEvent | null; error: string | null }> {
  const result = await callCalendarApi('upsert_event', {
    profile_id: profileId,
    event_data: eventData,
  }, initData);

  if (!result.success) {
    return { data: null, error: result.error ?? 'Unknown error' };
  }

  return { data: result.data as CalendarEvent | null, error: null };
}

/**
 * Deletes a calendar event.
 */
export async function deleteCalendarEvent(
  eventId: string,
  initData?: string
): Promise<{ error: string | null }> {
  const result = await callCalendarApi('delete_event', { event_id: eventId }, initData);

  if (!result.success) {
    return { error: result.error ?? 'Unknown error' };
  }

  return { error: null };
}

// ═══════════════════════════════════════════════════════
// Calendar Connections (OAuth)
// ═══════════════════════════════════════════════════════

/**
 * Fetches all active calendar connections for a profile.
 */
export async function getCalendarConnections(
  profileId: string,
  initData?: string
): Promise<{ data: CalendarConnection[] | null; error: string | null }> {
  if (!profileId || profileId.trim() === '') {
    return { data: [], error: null };
  }

  const result = await callCalendarApi('get_connections', { profile_id: profileId }, initData);

  if (!result.success) {
    return { data: null, error: result.error ?? 'Unknown error' };
  }

  return { data: (result.data ?? []) as CalendarConnection[], error: null };
}

// ═══════════════════════════════════════════════════════
// Reminder Settings
// ═══════════════════════════════════════════════════════

/**
 * Updates reminder_minutes_before for a calendar event.
 */
export async function updateReminderSettings(
  eventId: string,
  reminderMinutes: number | null,
  initData?: string
): Promise<{ success: boolean; error: string | null }> {
  const result = await callCalendarApi('update_reminder', {
    event_id: eventId,
    reminder_minutes: reminderMinutes,
  }, initData);

  if (!result.success) {
    return { success: false, error: result.error ?? 'Unknown error' };
  }

  return { success: true, error: null };
}

// ═══════════════════════════════════════════════════════
// Sync & Disconnect (Edge Functions fallback)
// ═══════════════════════════════════════════════════════

export interface SyncCalendarParams {
  profile_id: string;
  provider: CalendarProvider;
  action?: 'sync' | 'connect' | 'disconnect';
  code?: string;
}

/**
 * Initiates OAuth flow by calling calendar_sync Edge Function.
 */
export async function syncCalendar(
  params: SyncCalendarParams
): Promise<Record<string, unknown>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const token = localStorage.getItem('sb-token-auth-token');

  console.log('[calendar/syncCalendar] START', {
    profile_id: params.profile_id,
    provider: params.provider,
    action: params.action,
    supabaseUrl,
    hasToken: !!token,
  });

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    console.log('[calendar/syncCalendar] Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[calendar/syncCalendar] Error response:', errorData);
      throw new Error(errorData.error || `Sync failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('[calendar/syncCalendar] Success data:', data);
    return data as Record<string, unknown>;
  } catch (err) {
    console.error('[calendar/syncCalendar] Exception:', err);
    throw err;
  }
}

/**
 * Disconnects a calendar account.
 */
export async function disconnectCalendar(
  profileId: string,
  provider: CalendarProvider
): Promise<{ success: boolean; error: string | null }> {
  try {
    await syncCalendar({
      profile_id: profileId,
      provider,
      action: 'disconnect',
    });
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Disconnect failed',
    };
  }
}
