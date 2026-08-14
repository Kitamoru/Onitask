'use server';

/**
 * POST /api/calendar/sync — Прокси для calendar-sync Edge Function.
 * 
 * Решает CORS проблему: браузер не может напрямую вызывать Supabase Edge Functions
 * с кастомными headers (Authorization). Этот маршрут принимает initData, аутентифицирует
 * и проксирует запрос на Edge Function.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';

export async function POST(req: NextRequest) {
  // 1. Authenticate via Telegram initData
  const body = await req.json().catch(() => ({}));
  const { init_data } = body as { init_data?: string };

  const auth = await authenticateRequest(init_data);
  if (!auth.authenticated || !auth.profileId) {
    return NextResponse.json(
      { success: false, error: auth.error || 'unauthorized' },
      { status: auth.status || 401 }
    );
  }

  // 2. Extract params from body
  const { profile_id, provider, action, code } = body as {
    profile_id?: string;
    provider?: string;
    action?: string;
    code?: string;
  };

  // Security: only allow syncing own profile
  if (profile_id && profile_id !== auth.profileId) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
  }

  // 3. Proxy to Edge Function
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;

  try {
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        profile_id: profile_id || auth.profileId,
        provider,
        action,
        code,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[calendar/sync] Edge function error:', response.status, data);
      return NextResponse.json(
        { success: false, error: data.error || `Edge function error: ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[calendar/sync] Proxy error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to reach calendar-sync function' },
      { status: 502 }
    );
  }
}