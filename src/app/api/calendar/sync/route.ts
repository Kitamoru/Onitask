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
  // 1. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const { init_data, profile_id, provider, action, code } = body as {
    init_data?: string;
    profile_id?: string;
    provider?: string;
    action?: string;
    code?: string;
  };

  // Debug logging
  console.log('[calendar/sync] Request received:', {
    hasInitData: !!init_data,
    initDataLength: init_data?.length,
    profile_id,
    provider,
    action,
  });

  // 2. Authenticate via Telegram initData
  const auth = await authenticateRequest(init_data);
  
  console.log('[calendar/sync] Auth result:', {
    authenticated: auth.authenticated,
    profileId: auth.profileId,
    error: auth.error,
    status: auth.status,
  });

  if (!auth.authenticated || !auth.profileId) {
    return NextResponse.json(
      { success: false, error: auth.error || 'unauthorized' },
      { status: auth.status || 401 }
    );
  }

  // Security: only allow syncing own profile
  const targetProfile = profile_id || auth.profileId;
  if (targetProfile !== auth.profileId) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
  }

  // 3. Proxy to Edge Function
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;

  try {
    console.log('[calendar/sync] Proxing to edge function:', edgeFunctionUrl);
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        profile_id: targetProfile,
        provider,
        action,
        code,
      }),
    });

    const data = await response.json().catch(() => ({}));
    console.log('[calendar/sync] Edge function response:', response.status, JSON.stringify(data).substring(0, 200));

    if (!response.ok) {
      console.error('[calendar/sync] Edge function error:', response.status, JSON.stringify(data));
      // Return detailed error to client for better UX
      return NextResponse.json(
        { 
          success: false, 
          error: data.error || 'Edge function error',
          hint: data.hint || null,
          details: data.details || null,
        },
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
