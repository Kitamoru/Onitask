'use server';

/**
 * POST /api/calendar/connect/[provider] — Generate OAuth authorization URL
 * 
 * Returns an OAuth authorization URL for Yandex CalDAV using implicit token flow.
 * This flow is designed for client-side apps without a backend redirect endpoint.
 * 
 * Flow:
 * 1. User opens https://oauth.yandex.ru/authorize?response_type=token&client_id=XXX
 * 2. User grants permissions
 * 3. Yandex redirects to https://oauth.yandex.ru/verification_code#access_token=XXX
 * 4. User copies token from URL hash and pastes into app
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
 * Scope `calendar:read_all` запрашивает полный доступ к календарю Яндекса.
 */
function generateYandexOAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    scope: 'calendar:read_all', // обязательный scope для доступа к календарю
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
      instructions: 'После авторизации скопируйте токен из адресной строки https://oauth.yandex.ru/verification_code#access_token=XXX',
    });
  } catch (err) {
    console.error('[Calendar] connect error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}