'use server';

/**
 * POST /api/calendar/disconnect/[provider] — Disconnect a calendar account.
 * 
 * Deactivates the calendar connection in the database so the user can reconnect
 * with fresh tokens encrypted using the current ENCRYPTION_KEY.
 * 
 * Flow:
 * 1. User clicks "Отключить" in settings
 * 2. App sends request to this endpoint with profile_id + provider
 * 3. Endpoint calls calendar-sync Edge Function with action='disconnect'
 * 4. Edge Function sets is_active=false on the connection record
 * 
 * INV-17: tokens remain encrypted in DB but are deactivated
 */

import { NextRequest, NextResponse } from 'next/server';

type CalendarProvider = 'yandex';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const provider = (await params).provider as CalendarProvider;

    if (provider !== 'yandex') {
      return NextResponse.json(
        { success: false, error: 'invalid_provider' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { profile_id } = body as {
      profile_id?: string;
    };

    if (!profile_id) {
      return NextResponse.json(
        { success: false, error: 'missing_profile_id' },
        { status: 400 }
      );
    }

    // Call Edge Function to deactivate connection
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;

    const edgeResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        profile_id,
        provider,
        action: 'disconnect',
      }),
    });

    if (!edgeResponse.ok) {
      const errorData = await edgeResponse.json().catch(() => ({}));
      console.error('[Calendar Disconnect] Edge function error:', JSON.stringify(errorData));
      return NextResponse.json(
        { success: false, error: errorData.error || 'disconnect_failed' },
        { status: edgeResponse.status }
      );
    }

    const result = await edgeResponse.json();
    console.log('[Calendar Disconnect] Success:', result);

    return NextResponse.json({
      success: true,
      message: result.message || 'Calendar disconnected',
    });
  } catch (err) {
    console.error('[Calendar Disconnect] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}