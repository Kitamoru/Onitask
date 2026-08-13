'use server';

/**
 * POST /api/calendar/connect/[provider] — Generate OAuth authorization URL (Verification Code Flow)
 * 
 * Returns an OAuth redirect URL for Yandex CalDAV using verification_code flow.
 * The user opens this URL, authorizes, and receives a verification code on
 * https://oauth.yandex.ru/verification_code which they enter in the app.
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
 * Generate Yandex CalDAV OAuth authorization URL with verification_code flow.
 * 
 * Yandex OAuth verification_code flow:
 * 1. Redirect user to https://oauth.yandex.ru/authorize
 * 2. User grants permissions
 * 3. Yandex shows verification code at https://oauth.yandex.ru/verification_code
 * 4. User enters the code in the app
 * 5. App exchanges code for tokens via POST /api/calendar/callback/yandex
 * 
 * Scopes: caldav — access to CalDAV calendars
 */
function generateYandexOAuthUrl(
  clientId: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state: state,
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

    // Generate state parameter: encode workspace_id + worker_id + timestamp for CSRF protection
    const state = Buffer.from(
      JSON.stringify({
        workspace_id,
        worker_id: worker_id || '',
        ts: Date.now(),
      })
    ).toString('base64url');

    // Generate OAuth URL (no redirect_uri needed for verification_code flow)
    if (!yandexClientId) {
      console.error('[Calendar] YANDEX_OAUTH_CLIENT_ID not configured');
      return NextResponse.json(
        { success: false, error: 'yandex_oauth_not_configured' },
        { status: 500 }
      );
    }
    
    const oauthUrl = generateYandexOAuthUrl(yandexClientId, state);

    return NextResponse.json({
      success: true,
      url: oauthUrl,
      provider,
      // Instructions for the user
      instructions: 'После авторизации перейдите на https://oauth.yandex.ru/verification_code и введите полученный код в приложение',
    });
  } catch (err) {
    console.error('[Calendar] connect error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}