/**
 * Calendar Module API — onitask v0.14.0
 * Клиентские обёртки для Edge Functions calendar_sync и calendar_reminder.
 */

import { getClient } from '../supabase/client';
import type {
  CalendarEvent,
  CalendarConnection,
  CalendarProvider,
  CalendarSyncResponse,
} from '@/types/calendar';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

export interface SyncCalendarParams {
  workspace_id: string;
  provider: CalendarProvider;
  action?: 'sync' | 'connect' | 'disconnect';
  code?: string; // для OAuth connect
  worker_id?: string; // для disconnect
}

export interface ConnectOAuthParams {
  workspace_id: string;
  provider: CalendarProvider;
  code: string;
  worker_id: string;
  provider_account_email: string;
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Gets the current user's workspace_id from Supabase auth.
 */
async function getCurrentWorkspaceId(): Promise<string | null> {
  const supabase = getClient();
  // Get current user session
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: worker } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', user.id)
    .single();

  return worker?.workspace_id ?? null;
}

// ═══════════════════════════════════════════════════════
// Calendar Events CRUD
// ═══════════════════════════════════════════════════════

/**
 * Fetches all calendar events for a workspace within a date range.
 */
export async function getCalendarEvents(
  workspaceId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    provider?: CalendarProvider;
    limit?: number;
  }
): Promise<{ data: CalendarEvent[] | null; error: unknown }> {
  const supabase = getClient();
  const { startDate, endDate, provider, limit = 200 } = options ?? {};

  let query = supabase
    .from('calendar_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('start_at', { ascending: true })
    .limit(limit);

  if (startDate && endDate) {
    query = query.or(
      `start_at.gte.${startDate.toISOString()},end_at.lte.${endDate.toISOString()}`
    );
  }

  if (provider) {
    query = query.eq('provider', provider);
  }

  const { data, error } = await query as {
    data: CalendarEvent[] | null;
    error: unknown;
  };

  return { data, error };
}

/**
 * Creates or updates a calendar event manually.
 */
export async function upsertCalendarEvent(
  workspaceId: string,
  eventData: Omit<CalendarEvent, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
): Promise<{ data: CalendarEvent | null; error: unknown }> {
  const supabase = getClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('calendar_events')
    .upsert({
      ...eventData,
      workspace_id: workspaceId,
      updated_by: user?.id ?? null,
    }, {
      onConflict: 'workspace_id,remote_event_id',
      ignoreDuplicates: false,
    })
    .select()
    .single() as { data: CalendarEvent | null; error: unknown };

  return { data, error };
}

/**
 * Deletes a calendar event.
 */
export async function deleteCalendarEvent(eventId: string): Promise<{ error: unknown }> {
  const supabase = getClient();
  const { error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', eventId);

  return { error };
}

// ═══════════════════════════════════════════════════════
// Calendar Connections (OAuth)
// ═══════════════════════════════════════════════════════

/**
 * Fetches all active calendar connections for a workspace.
 */
export async function getCalendarConnections(
  workspaceId: string
): Promise<{ data: CalendarConnection[] | null; error: unknown }> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('connected_at', { ascending: false }) as {
      data: CalendarConnection[] | null;
      error: unknown;
    };

  return { data, error };
}

/**
 * Initiates OAuth flow by calling calendar_sync Edge Function.
 */
export async function syncCalendar(params: SyncCalendarParams): Promise<CalendarSyncResponse> {
  const supabase = getClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? '';

  const response = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Sync failed: ${response.status}`);
  }

  return response.json() as Promise<CalendarSyncResponse>;
}

/**
 * Disconnects a calendar account.
 */
export async function disconnectCalendar(
  workspaceId: string,
  provider: CalendarProvider,
  workerId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    await syncCalendar({
      workspace_id: workspaceId,
      provider,
      action: 'disconnect',
      worker_id: workerId,
    });
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Disconnect failed',
    };
  }
}

// ═══════════════════════════════════════════════════════
// Reminder Settings
// ═══════════════════════════════════════════════════════

/**
 * Updates reminder_minutes_before for a calendar event.
 */
export async function updateReminderSettings(
  eventId: string,
  reminderMinutes: number | null
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = getClient();
    const { error } = await supabase
      .from('calendar_events')
      .update({ reminder_minutes_before: reminderMinutes })
      .eq('id', eventId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Update failed',
    };
  }
}