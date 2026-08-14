'use server';

/**
 * POST /api/calendar/connect/[provider] — Generate OAuth authorization URL
 * 
 * Returns an OAuth authorization URL for Yandex CalDAV using authorization code flow.
 * 
 * Flow:
 * 1. User opens https://oauth.yandex.ru/authorize?response_type=code&client_id=XXX&redirect_uri=YYY
 * 2. User grants permissions → Yandex redirects to redirect_uri?code=XXX
 * 3. Backend exchanges code for access_token + refresh_token
 * 4. Tokens are encrypted and stored in calendar_connections
 * 5. Initial sync happens automatically
 * 
 * INV-05: workspace_id is required for all calendar operations
 * onitask_calendar_.md §3
 */

import { NextRequest, NextResponse } from 'next/server';

type CalendarProvider = 'yandex';

interface RequestBody {
  profile_id: string;
}

function generateYandexOAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'calendar:all',
    redirect_uri: redirectUri,
  });

  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const body = await req.json() as RequestBody;
    const { profile_id } = body;
    const provider = (await params).provider as CalendarProvider;

    // Validate provider
    if (provider !== 'yandex') {
      return NextResponse.json(
        { success: false, error: 'invalid_provider', allowed: ['yandex'] },
        { status: 400 }
      );
    }

    // Validate profile_id
    if (!profile_id) {
      return NextResponse.json(
        { success: false, error: 'missing_profile_id' },
        { status: 400 }
      );
    }

    // Get OAuth credentials from environment
    const yandexClientId = process.env.YANDEX_OAUTH_CLIENT_ID || '';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

    if (!yandexClientId) {
      console.error('[Calendar] YANDEX_OAUTH_CLIENT_ID not configured');
      return NextResponse.json(
        { success: false, error: 'yandex_oauth_not_configured' },
        { status: 500 }
      );
    }

    const redirectUri = `${supabaseUrl}/api/calendar/callback/yandex`;
    const oauthUrl = generateYandexOAuthUrl(yandexClientId, redirectUri);

    return NextResponse.json({
      success: true,
      url: oauthUrl,
      provider,
    });
  } catch (err) {
    console.error('[Calendar] connect error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}