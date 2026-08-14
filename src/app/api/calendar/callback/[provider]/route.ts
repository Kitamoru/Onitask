'use server';

/**
 * POST /api/calendar/callback/yandex — Store OAuth token for Yandex CalDAV
 * 
 * Called from the client after user obtains OAuth token via implicit grant flow.
 * Token is encrypted and stored in `calendar_connections`.
 * 
 * Flow:
 * 1. User opens https://oauth.yandex.ru/authorize?response_type=token&client_id=XXX
 * 2. User authorizes → redirected to https://oauth.yandex.ru/verification_code#access_token=XXX
 * 3. User copies token from URL hash and pastes into app
 * 4. App sends token to this endpoint for storage
 * 
 * onitask_calendar_.md §3.1-3.2
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
    const { token, workspace_id, worker_id } = body as {
      token?: string;
      workspace_id?: string;
      worker_id?: string;
    };

    // Validate required fields
    // Calendar connections are per-user (worker), not per-workspace
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'missing_token' },
        { status: 400 }
      );
    }

    if (!worker_id) {
      return NextResponse.json(
        { success: false, error: 'missing_worker_id' },
        { status: 400 }
      );
    }

    // Store token via Edge Function (handles encryption + DB storage)
    // worker_id is required; workspace_id is optional (used for filtering events)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    
    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;
    
    const edgeResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        worker_id,
        workspace_id, // optional — used for event filtering, not required for connection
        provider,
        action: 'connect',
        access_token: token,
      }),
    });

    if (!edgeResponse.ok) {
      const errorData = await edgeResponse.json().catch(() => ({}));
      console.error(`[Calendar Callback] Edge function error (${edgeResponse.status}):`, errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || 'connection_failed' },
        { status: edgeResponse.status }
      );
    }

    const result = await edgeResponse.json();
    console.log(`[Calendar Callback] ${provider} connected successfully via token:`, result);

    return NextResponse.json({
      success: true,
      synced: result.synced || 0,
    });

  } catch (err) {
    console.error('[Calendar Callback] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}