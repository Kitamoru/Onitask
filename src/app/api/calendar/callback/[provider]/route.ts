'use server';

/**
 * GET /api/calendar/callback/[provider] — OAuth callback handler
 * 
 * Handles the OAuth redirect from the provider after user authorization.
 * Exchanges the authorization code for tokens via the calendar_sync Edge Function,
 * which encrypts and stores them in `calendar_connections`.
 * 
 * Flow:
 * 1. Provider redirects with ?code=...&state=...
 * 2. Validate state (workspace_id, worker_id)
 * 3. Call calendar_sync Edge Function with action='connect' & code
 * 4. Redirect to success/failure page
 * 
 * onitask_calendar_.md §3.1-3.2
 */

import { NextRequest, NextResponse } from 'next/server';

type CalendarProvider = 'yandex' | 'outlook';

interface StatePayload {
  workspace_id: string;
  worker_id: string;
  ts: number;
}

/**
 * Verify state parameter to prevent CSRF attacks.
 * State must be valid base64url JSON with timestamp < 5 minutes old.
 */
function verifyState(state: string): StatePayload | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf-8');
    const parsed: StatePayload = JSON.parse(decoded);

    // Check timestamp (state expires after 5 minutes)
    if (!parsed.ts || Date.now() - parsed.ts > 5 * 60 * 1000) {
      console.error('[Calendar Callback] State expired');
      return null;
    }

    // Validate required fields
    if (!parsed.workspace_id) {
      console.error('[Calendar Callback] Missing workspace_id in state');
      return null;
    }

    return parsed;
  } catch (err) {
    console.error('[Calendar Callback] Invalid state:', err);
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const provider = (await params).provider as CalendarProvider;

    // Validate provider
    if (!['yandex', 'outlook'].includes(provider)) {
      const errorUrl = new URL('/calendar', req.url);
      errorUrl.searchParams.set('error', 'invalid_provider');
      return NextResponse.redirect(errorUrl);
    }

    // Get query parameters
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Handle provider error
    if (error) {
      const errorDesc = url.searchParams.get('error_description') || error;
      console.error(`[Calendar Callback] ${provider} error:`, errorDesc);
      return NextResponse.redirect(
        new URL(`/calendar?error=${encodeURIComponent(errorDesc)}`, url.origin)
      );
    }

    // Validate required parameters
    if (!code) {
      console.error('[Calendar Callback] Missing authorization code');
      return NextResponse.redirect(
        new URL('/calendar?error=missing_code', url.origin)
      );
    }

    if (!state) {
      console.error('[Calendar Callback] Missing state parameter');
      return NextResponse.redirect(
        new URL('/calendar?error=missing_state', url.origin)
      );
    }

    // Verify state
    const statePayload = verifyState(state);
    if (!statePayload) {
      return NextResponse.redirect(
        new URL('/calendar?error=invalid_state', url.origin)
      );
    }

    const { workspace_id, worker_id } = statePayload;

    // Exchange code for tokens via Edge Function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    
    // Get user session token for authentication
    // In TWA, we use the stored session or re-authenticate
    const cookies = req.cookies;
    const sessionToken = cookies.get('sb-' + supabaseUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-') + '-auth-token-standalone')?.value 
      || cookies.get('__session')?.value 
      || '';

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/calendar-sync`;
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        workspace_id,
        worker_id,
        provider,
        action: 'connect',
        code,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[Calendar Callback] Edge function error (${response.status}):`, errorData);
      
      const errorMsg = errorData.error || 'connection_failed';
      return NextResponse.redirect(
        new URL(`/calendar?error=${encodeURIComponent(errorMsg)}`, url.origin)
      );
    }

    const result = await response.json();
    console.log(`[Calendar Callback] ${provider} connected successfully:`, result);

    // Redirect to calendar page with success message
    return NextResponse.redirect(
      new URL(`/calendar?connected=${provider}&synced=${result.synced || 0}`, url.origin)
    );
  } catch (err) {
    console.error('[Calendar Callback] Unexpected error:', err);
    
    // Redirect to calendar with generic error
    const url = new URL('/calendar', req.url);
    url.searchParams.set('error', encodeURIComponent('internal_error'));
    return NextResponse.redirect(url);
  }
}