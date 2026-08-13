'use server';

/**
 * POST /api/calendar/connect/[provider] — Generate OAuth authorization URL
 * 
 * Returns an OAuth redirect URL for Yandex CalDAV using implicit token flow.
 * The user opens this URL, authorizes, and receives a token directly in the
 * browser hash fragment at https://oauth.yandex.ru/verification_code
 * 
 * INV-05: workspace_id is required for all calendar operations
 * onitask_calendar_.md §3
 */

import { NextRequest, NextResponse } from 'next/server';

type CalendarProvider = 'yandex';

interface RequestBody {
  workspace_id: string;
  worker_id?: string;
}

/**
 * Generate Yandex CalDAV OAuth authorization URL with implicit token flow.
 * 
 * Yandex OAuth implicit token flow (for debugging/testing):
 * 1. User opens https://oauth.yandex.ru/authorize?response_type=token&client_id=XXX
 * 2. User grants permissions
 * 3. Yandex redirects to https://oauth.yandex.ru/verification_code#access_token=XXX
 * 4. Token is extracted from the URL hash fragment
 * 
 * Scopes: caldav — access to CalDAV calendars
 */
function generateYandexOAuthUrl(
  clientId: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token', // implicit grant — returns token directly
    scope: 'caldav', // CalDAV access only
  });

  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const body = await req.json() as RequestBody;
    const { workspace_id, worker_id } = body;
    const provider = (await params).provider as CalendarProvider;

    // Validate provider
    if (provider !== 'yandex') {
      return NextResponse.json(
        { success: false, error: 'invalid_provider', allowed: ['yandex'] },
        { status: 400 }
      );
    }

    // Validate workspace_id
    if (!workspace_id) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id' },
        { status: 400 }
      );
    }

    // Get OAuth credentials from environment
    const yandexClientId = process.env.YANDEX_OAUTH_CLIENT_ID || '';

    // Generate OAuth URL (no redirect_uri needed for verification_code flow)
    if (!yandexClientId) {
      console.error('[Calendar] YANDEX_OAUTH_CLIENT_ID not configured');
      return NextResponse.json(
        { success: false, error: 'yandex_oauth_not_configured' },
        { status: 500 }
      );
    }
    
    const oauthUrl = generateYandexOAuthUrl(yandexClientId);

    return NextResponse.json({
      success: true,
      url: oauthUrl,
      provider,
      // Instructions for the user
      instructions: 'После авторизации перейдите на https://oauth.yandex.ru/verification_code — токен будет в адресной строке после access_token=',
    });
  } catch (err) {
    console.error('[Calendar] connect error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}