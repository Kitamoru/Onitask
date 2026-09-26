'use server';

/**
 * POST /api/calendar/set-password — Store the Yandex CalDAV app password (CAL-08).
 *
 * Yandex CalDAV only accepts HTTP Basic (login + app password); the OAuth token
 * cannot read a calendar (verified 2026-09-26). The password therefore has to be
 * supplied by the user, and this endpoint is the only client-facing way in.
 *
 * The password is forwarded to the Edge Function, which encrypts it with
 * AES-256-GCM before storage (INV-17). It is never logged and never returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../lib/api-auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      provider?: string;
      caldav_password?: string;
      init_data?: string;
    };

    if (body.provider && body.provider !== 'yandex') {
      return NextResponse.json(
        { success: false, error: 'invalid_provider', allowed: ['yandex'] },
        { status: 400 }
      );
    }

    const password = body.caldav_password?.trim();
    if (!password) {
      return NextResponse.json(
        { success: false, error: 'missing_caldav_password' },
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
      console.error('[Calendar] SUPABASE_SERVICE_ROLE_KEY not configured');
      return NextResponse.json({ success: false, error: 'config_error' }, { status: 500 });
    }

    const edgeResponse = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        profile_id: auth.profileId,
        provider: 'yandex',
        action: 'set_password',
        caldav_password: password,
      }),
    });

    if (!edgeResponse.ok) {
      const errorData = await edgeResponse.json().catch(() => ({}));
      console.error(
        `[Calendar] set_password edge error (${edgeResponse.status}):`,
        errorData.error ?? 'unknown'
      );
      return NextResponse.json(
        { success: false, error: errorData.error || 'password_save_failed' },
        { status: edgeResponse.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Calendar] set_password error:', err);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
