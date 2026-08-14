'use server';

/**
 * POST /api/calendar/verify-code — Exchange Yandex authorization code for tokens
 * 
 * Flow:
 * 1. User opens OAuth URL → authorizes on oauth.yandex.ru
 * 2. Yandex redirects to https://oauth.yandex.ru/verification_code?code=XXX&state=YYY
 * 3. User copies the code from that page and pastes it into our app
 * 4. Our backend exchanges code for access_token + refresh_token
 * 5. Tokens are encrypted and stored in calendar_connections
 * 6. Initial sync happens automatically
 * 
 * IMPORTANT: We cannot intercept the Yandex redirect because redirect_uri is fixed
 * to https://oauth.yandex.ru/verification_code (Yandex's domain).
 * The user must manually copy-paste the code.
 */

import { NextRequest, NextResponse } from 'next/server';

interface RequestBody {
  profile_id: string;
  provider: 'yandex';
  code: string;
}

async function exchangeYandexTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const clientId = process.env.YANDEX_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.YANDEX_OAUTH_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    throw new Error('YANDEX_OAUTH_CLIENT_ID and YANDEX_OAUTH_CLIENT_SECRET must be configured');
  }

  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Yandex token exchange failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error('Yandex token exchange returned no access_token');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 31536000), // default 1 year
  };
}

async function getYandexAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Yandex get account email failed: ${response.status}`);
  }

  const data = await response.json() as { email?: string; default_email?: string };
  const email = data.email || data.default_email;

  if (!email) {
    throw new Error('Yandex returned no email in user info');
  }

  return email;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as RequestBody;
    const { profile_id, provider, code } = body;

    // Validate inputs
    if (!profile_id) {
      return NextResponse.json(
        { success: false, error: 'missing_profile_id' },
        { status: 400 }
      );
    }

    if (provider !== 'yandex') {
      return NextResponse.json(
        { success: false, error: 'invalid_provider', allowed: ['yandex'] },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'missing_code' },
        { status: 400 }
      );
    }

    // Exchange code for tokens
    console.log('[Calendar] Exchanging Yandex code for tokens...');
    let tokens: Awaited<ReturnType<typeof exchangeYandexTokens>>;
    try {
      tokens = await exchangeYandexTokens(code);
      console.log('[Calendar] Token exchange successful, has_refresh_token=', !!tokens?.refresh_token);
    } catch (tokenErr) {
      console.error('[Calendar] Token exchange error:', tokenErr);
      return NextResponse.json(
        {
          success: false,
          error: 'token_exchange_failed',
          details: tokenErr instanceof Error ? tokenErr.message : 'unknown',
        },
        { status: 400 }
      );
    }

    // Get account email
    let accountEmail: string;
    try {
      accountEmail = await getYandexAccountEmail(tokens.access_token);
      console.log('[Calendar] Account email:', accountEmail);
    } catch (emailErr) {
      console.error('[Calendar] Failed to get account email:', emailErr);
      accountEmail = 'yandex_user';
    }

    // Call Edge Function to save tokens and sync
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseServiceKey) {
      console.error('[Calendar] SUPABASE_SERVICE_ROLE_KEY not configured');
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
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        profile_id,
        provider,
        action: 'connect',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        provider_account_email: accountEmail,
      }),
    });

    if (!edgeResponse.ok) {
      const errorData = await edgeResponse.json().catch(() => ({}));
      console.error(`[Calendar] Edge function error (${edgeResponse.status}):`, JSON.stringify(errorData));
      return NextResponse.json(
        {
          success: false,
          error: 'connection_save_failed',
          details: errorData,
        },
        { status: 500 }
      );
    }

    const result = await edgeResponse.json();
    console.log(`[Calendar] Connected successfully:`, JSON.stringify(result));

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[Calendar] Verify code error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}