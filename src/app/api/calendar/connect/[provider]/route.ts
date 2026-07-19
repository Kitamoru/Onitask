'use server';

/**
 * POST /api/calendar/connect/[provider] — Generate OAuth authorization URL
 * 
 * Returns an OAuth redirect URL for the specified provider (yandex | outlook).
 * The client opens this URL in a new window/tab to initiate the OAuth flow.
 * 
 * INV-05: workspace_id is required for all calendar operations
 * onitask_calendar_.md §3
 */

import { NextRequest, NextResponse } from 'next/server';

type CalendarProvider = 'yandex' | 'outlook';

interface RequestBody {
  workspace_id: string;
  worker_id?: string;
}

/**
 * Generate Yandex CalDAV OAuth authorization URL.
 * 
 * Yandex OAuth flow:
 * 1. Redirect user to https://oauth.yandex.ru/authorize
 * 2. User grants permissions
 * 3. Yandex redirects to redirect_uri with ?code=...
 * 
 * Scopes: caldav — access to CalDAV calendars
 */
function generateYandexOAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: state,
    scope: 'caldav', // CalDAV access only
  });

  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

/**
 * Generate Outlook Graph API OAuth authorization URL.
 * 
 * Microsoft OAuth flow:
 * 1. Redirect user to https://login.microsoftonline.com/common/oauth2/v2.0/authorize
 * 2. User signs in and grants permissions
 * 3. Microsoft redirects to redirect_uri with ?code=...
 * 
 * Scopes: Cal.Read — read calendar events only (no write)
 */
function generateOutlookOAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const scopes = 'Cal.Read offline_access';
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes,
    response_mode: 'query',
    state: state,
    prompt: 'consent', // Force consent screen to ensure refresh_token is returned
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
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
    if (!['yandex', 'outlook'].includes(provider)) {
      return NextResponse.json(
        { success: false, error: 'invalid_provider', allowed: ['yandex', 'outlook'] },
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
    const outlookClientId = process.env.OUTLOOK_OAUTH_CLIENT_ID || '';
    
    // Base redirect URI — will be appended with /callback/[provider]
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/calendar/callback/${provider}`;

    // Generate state parameter: encode workspace_id + worker_id + timestamp for CSRF protection
    const state = Buffer.from(
      JSON.stringify({
        workspace_id,
        worker_id: worker_id || '',
        ts: Date.now(),
      })
    ).toString('base64url');

    // Generate OAuth URL based on provider
    let oauthUrl: string;

    if (provider === 'yandex') {
      if (!yandexClientId) {
        console.error('[Calendar] YANDEX_OAUTH_CLIENT_ID not configured');
        return NextResponse.json(
          { success: false, error: 'yandex_oauth_not_configured' },
          { status: 500 }
        );
      }
      oauthUrl = generateYandexOAuthUrl(yandexClientId, redirectUri, state);
    } else {
      if (!outlookClientId) {
        console.error('[Calendar] OUTLOOK_OAUTH_CLIENT_ID not configured');
        return NextResponse.json(
          { success: false, error: 'outlook_oauth_not_configured' },
          { status: 500 }
        );
      }
      oauthUrl = generateOutlookOAuthUrl(outlookClientId, redirectUri, state);
    }

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