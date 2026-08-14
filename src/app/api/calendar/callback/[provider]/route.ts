'use server';

/**
 * GET /api/calendar/callback/yandex — Exchange OAuth code for tokens
 * 
 * Called by Yandex redirect after user authorizes via authorization code flow.
 * 
 * Flow:
 * 1. User opens https://oauth.yandex.ru/authorize?response_type=code&client_id=XXX&redirect_uri=YYY
 * 2. User authorizes → Yandex redirects to redirect_uri?code=XXX&state=YYY
 * 3. Backend exchanges code for access_token + refresh_token
 * 4. Tokens are encrypted and stored in calendar_connections
 * 5. Initial sync happens automatically
 * 
 * onitask_calendar_.md §3.1-3.2
 */

import { NextRequest, NextResponse } from 'next/server';

type CalendarProvider = 'yandex';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const provider = (await params).provider as CalendarProvider;

    if (provider !== 'yandex') {
      return NextResponse.redirect(new URL('/settings?calendar_error=invalid_provider', req.url));
    }

    const url = new URL(req.url);
    
    // Handle auth errors from Yandex
    const error = url.searchParams.get('error');
    if (error) {
      console.error('[Calendar Callback] Yandex auth error:', url.searchParams.get('error_description'));
      return NextResponse.redirect(new URL('/settings?calendar_error=auth_denied', req.url));
    }

    const code = url.searchParams.get('code');
    if (!code) {
      console.error('[Calendar Callback] Missing code parameter');
      return NextResponse.redirect(new URL('/settings?calendar_error=no_code', req.url));
    }

    // profile_id передается через state параметр OAuth
    const profileId = url.searchParams.get('state');
    if (!profileId) {
      console.error('[Calendar Callback] Missing state (profile_id) parameter');
      return NextResponse.redirect(new URL('/settings?calendar_error=no_profile', req.url));
    }

    // Exchange code for tokens via Edge Function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    
    if (!supabaseServiceKey) {
      console.error('[Calendar Callback] SUPABASE_SERVICE_ROLE_KEY not configured');
      return NextResponse.redirect(new URL('/settings?calendar_error=config_error', req.url));
    }
    
    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;
    
    const edgeResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        profile_id: profileId,
        provider,
        action: 'connect',
        code,
      }),
    });

    if (!edgeResponse.ok) {
      const errorData = await edgeResponse.json().catch(() => ({}));
      console.error(`[Calendar Callback] Edge function error (${edgeResponse.status}):`, JSON.stringify(errorData));
      return NextResponse.redirect(new URL('/settings?calendar_error=connect_failed', req.url));
    }

    const result = await edgeResponse.json();
    console.log(`[Calendar Callback] ${provider} connected successfully:`, JSON.stringify(result));

    return NextResponse.redirect(
      new URL(`/settings?calendar_connected=true&synced=${result.synced || 0}`, req.url)
    );

  } catch (err) {
    console.error('[Calendar Callback] Unexpected error:', err);
    return NextResponse.redirect(new URL('/settings?calendar_error=internal', req.url));
  }
}