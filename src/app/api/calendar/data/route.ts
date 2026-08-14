'use server';

/**
 * POST /api/calendar/data — Calendar data operations (server-side, service role).
 *
 * Консолидированный endpoint для календаря. Использует Telegram initData для
 * аутентификации (как /api/workspaces/my-data) и service role для обхода RLS.
 *
 * Причина: клиентский supabase (anon key) блокируется RLS `profile_id = auth.uid()`,
 * т.к. в проекте нет Supabase Auth — только Telegram initData.
 *
 * Actions:
 *   get_events       → { init_data, profile_id, start_date?, end_date?, provider?, limit? }
 *   get_connections  → { init_data, profile_id }
 *   update_reminder  → { init_data, event_id, reminder_minutes }
 *   upsert_event     → { init_data, profile_id, event_data }
 *   delete_event     → { init_data, event_id }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import type { Database } from '../../../../../types/supabase';

type CalendarEventRow = Database['public']['Tables']['calendar_events']['Row'];
type CalendarConnectionRow = Database['public']['Tables']['calendar_connections']['Row'];

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const { init_data, action } = body as { init_data?: string; action?: string };

  // 1. Authenticate via Telegram initData
  const auth = await authenticateRequest(init_data);
  if (!auth.authenticated || !auth.profileId) {
    return NextResponse.json(
      { success: false, error: auth.error || 'unauthorized' },
      { status: auth.status || 401 }
    );
  }

  const supabase = createServerClient();

  try {
    switch (action) {
      case 'get_events': {
        const { profile_id, start_date, end_date, provider, limit = 200 } = body as {
          profile_id?: string;
          start_date?: string;
          end_date?: string;
          provider?: string;
          limit?: number;
        };

        // Security: only allow fetching own profile's events
        const targetProfile = profile_id || auth.profileId;
        if (targetProfile !== auth.profileId) {
          return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
        }

        let query = supabase
          .from('calendar_events')
          .select('*')
          .eq('profile_id', targetProfile)
          .order('start_at', { ascending: true })
          .limit(limit);

        if (start_date && end_date) {
          query = query.or(`start_at.gte.${start_date},end_at.lte.${end_date}`);
        }

        if (provider) {
          query = query.eq('provider', provider);
        }

        const { data, error } = await query as { data: CalendarEventRow[] | null; error: unknown };
        if (error) {
          return NextResponse.json({ success: false, error: 'database_error', details: error }, { status: 500 });
        }
        return NextResponse.json({ success: true, data });
      }

      case 'get_connections': {
        const { profile_id } = body as { profile_id?: string };
        const targetProfile = profile_id || auth.profileId;
        if (targetProfile !== auth.profileId) {
          return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
        }

        const { data, error } = await supabase
          .from('calendar_connections')
          .select('*')
          .eq('profile_id', targetProfile)
          .eq('is_active', true)
          .order('connected_at', { ascending: false }) as {
            data: CalendarConnectionRow[] | null;
            error: unknown;
          };

        if (error) {
          return NextResponse.json({ success: false, error: 'database_error', details: error }, { status: 500 });
        }
        return NextResponse.json({ success: true, data });
      }

      case 'update_reminder': {
        const { event_id, reminder_minutes } = body as {
          event_id?: string;
          reminder_minutes?: number | null;
        };
        if (!event_id) {
          return NextResponse.json({ success: false, error: 'event_id_required' }, { status: 400 });
        }

        // Verify the event belongs to the authenticated profile
        const { data: event } = await supabase
          .from('calendar_events')
          .select('profile_id')
          .eq('id', event_id)
          .maybeSingle();

        if (!event || event.profile_id !== auth.profileId) {
          return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
        }

        const { error } = await supabase
          .from('calendar_events')
          .update({ reminder_minutes_before: reminder_minutes ?? null })
          .eq('id', event_id);

        if (error) {
          return NextResponse.json({ success: false, error: 'database_error', details: error }, { status: 500 });
        }
        return NextResponse.json({ success: true });
      }

      case 'upsert_event': {
        const { profile_id, event_data } = body as {
          profile_id?: string;
          event_data?: Record<string, unknown>;
        };
        const targetProfile = profile_id || auth.profileId;
        if (targetProfile !== auth.profileId) {
          return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
        }
        if (!event_data) {
          return NextResponse.json({ success: false, error: 'event_data_required' }, { status: 400 });
        }

        // Build upsert payload with required fields
        const upsertPayload: Record<string, unknown> = {
          ...event_data,
          profile_id: targetProfile,
          updated_by: auth.profileId,
        };

        const { data, error } = await supabase
          .from('calendar_events')
          .upsert(upsertPayload as Database['public']['Tables']['calendar_events']['Insert'], {
            onConflict: 'profile_id,provider,remote_event_id',
            ignoreDuplicates: false,
          })
          .select()
          .single() as { data: CalendarEventRow | null; error: unknown };

        if (error) {
          return NextResponse.json({ success: false, error: 'database_error', details: error }, { status: 500 });
        }
        return NextResponse.json({ success: true, data });
      }

      case 'delete_event': {
        const { event_id } = body as { event_id?: string };
        if (!event_id) {
          return NextResponse.json({ success: false, error: 'event_id_required' }, { status: 400 });
        }

        const { data: event } = await supabase
          .from('calendar_events')
          .select('profile_id')
          .eq('id', event_id)
          .maybeSingle();

        if (!event || event.profile_id !== auth.profileId) {
          return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
        }

        const { error } = await supabase
          .from('calendar_events')
          .delete()
          .eq('id', event_id);

        if (error) {
          return NextResponse.json({ success: false, error: 'database_error', details: error }, { status: 500 });
        }
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ success: false, error: 'unknown_action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[calendar/data] unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}