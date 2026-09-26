'use server';

/**
 * POST /api/calendar/disconnect/[provider] — Disconnect a calendar account.
 *
 * Deactivates the calendar connection so the user can reconnect with fresh
 * tokens encrypted under the current ENCRYPTION_KEY.
 *
 * Flow:
 * 1. App posts { init_data } to this endpoint
 * 2. Endpoint authenticates the Telegram session
 * 3. Endpoint calls calendar-sync with action='disconnect' for auth.profileId
 * 4. Edge Function sets is_active=false on the connection record
 *
 * INV-17: tokens remain encrypted in DB but are deactivated.
 *
 * This route used to take `profile_id` from the request body and never
 * authenticate, so anybody could POST an arbitrary profile id and disconnect
 * someone else's calendar. It also forwarded the anon key — which is public in
 * the client bundle — to the Edge Function. Identity now comes from the
 * validated session only, and the call is made with the service-role key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../../lib/api-auth';

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

    let body: { init_data?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid_json' },
        { status: 400 }
      );
    }

    // Identity comes from the validated session, never from the request body.
    const auth = await authenticateRequest(body.init_data);
    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!serviceKey) {
      console.error('[Calendar Disconnect] SUPABASE_SERVICE_ROLE_KEY not configured');
      return NextResponse.json(
        { success: false, error: 'config_error' },
        { status: 500 }
      );
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;

    const edgeResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        profile_id: auth.profileId,
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
