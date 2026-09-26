'use server';

/**
 * POST /api/calendar/connect/yandex — Generate Yandex CalDAV OAuth URL
 * 
 * Returns an OAuth authorization URL for Yandex CalDAV using authorization code flow.
 * 
 * IMPORTANT: Yandex requires redirect_uri = https://oauth.yandex.ru/verification_code
 * This is a special Yandex endpoint used when you cannot set a custom redirect URI
 * (e.g., in Telegram Web Apps or mobile apps).
 * 
 * Flow:
 * 1. User opens https://oauth.yandex.ru/authorize?response_type=code&client_id=XXX&redirect_uri=https://oauth.yandex.ru/verification_code
 * 2. User grants permissions → Yandex shows verification_code page with authorization code
 * 3. User copies the code and pastes it into our app
 * 4. Our backend exchanges code for access_token + refresh_token via POST https://oauth.yandex.ru/token
 * 5. Tokens are encrypted and stored in calendar_connections
 * 6. Initial sync happens automatically
 * 
 * onitask_calendar_.md §3
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../../lib/api-auth';
import { signCalendarState } from '../../../../../../lib/calendar-oauth-state';

type CalendarProvider = 'yandex';

interface RequestBody {
  // `profile_id` принимается только для обратной совместимости и игнорируется:
  // после authenticateRequest личность известна серверу, клиентскому значению
  // верить нельзя. `state` для OAuth строится из auth.profileId.
  profile_id?: string;
  init_data?: string;
}

// Yandex requires this specific redirect URI for verification_code flow
const YANDEX_VERIFICATION_CODE_URI = 'https://oauth.yandex.ru/verification_code';

// Shown in the client modal after the OAuth window opens.
const YANDEX_INSTRUCTIONS =
  '1. Разрешите доступ к календарю на странице Яндекса.\n' +
  '2. Яндекс покажет страницу с кодом авторизации — скопируйте его.\n' +
  '3. Вставьте код в поле ниже и нажмите «Подключить».';

function generateYandexOAuthUrl(clientId: string, profileId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'calendar:read_all',
    redirect_uri: YANDEX_VERIFICATION_CODE_URI,
    // Signed, expiring state. The raw profile_id used to go here, which let
    // anyone forge a callback URL and write their own calendar into someone
    // else's connection row.
    state: signCalendarState(profileId),
  });

  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const body = await req.json() as RequestBody;
    const { init_data } = body;
    const provider = (await params).provider as CalendarProvider;

    // Validate provider
    if (provider !== 'yandex') {
      return NextResponse.json(
        { success: false, error: 'invalid_provider', allowed: ['yandex'] },
        { status: 400 }
      );
    }

    // Authenticate via Telegram initData. The returned URL carries the profile id
    // in `state`, so identity must come from the validated session — never from
    // the request body.
    const auth = await authenticateRequest(init_data);
    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 }
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

    const oauthUrl = generateYandexOAuthUrl(yandexClientId, auth.profileId);

    return NextResponse.json({
      success: true,
      url: oauthUrl,
      provider,
      instructions: YANDEX_INSTRUCTIONS,
      redirect_uri: YANDEX_VERIFICATION_CODE_URI,
    });
  } catch (err) {
    console.error('[Calendar] connect error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}