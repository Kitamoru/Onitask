/**
 * Supabase Edge Function: calendar_sync
 *
 * Модуль «Календарь» v0.14.0 — синхронизация событий из внешних календарей.
 * Поддерживаемые провайдеры: Yandex CalDAV, Outlook Graph API.
 *
 * Архитектура:
 * - OAuth flow: пользователь авторизуется через провайдера → код обмена на токены
 *   → шифрование AES-256-GCM (INV-17) → сохранение в calendar_connections
 * - Синхронизация: дешифрование токенов → fetch событий → upsert в calendar_events
 * - Все вызовы к внешним API — Cold Path в Supabase Edge Functions (A-1)
 *
 * Лицензии: MIT/Apache-2.0/BSD разрешены; GPL/AGPL запрещены для этого модуля.
 *
 * Master Spec §6.19, onitask_calendar_.md §4
 */

// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface CalendarConnection {
  id: string;
  workspace_id: string;
  worker_id: string;
  provider: 'yandex' | 'outlook';
  provider_account_email: string;
  encrypted_oauth_tokens: Uint8Array;
  token_expires_at: string | null;
  is_active: boolean;
  last_sync_at: string | null;
}

interface CalendarEventPayload {
  workspace_id: string;
  provider: 'yandex' | 'outlook';
  remote_event_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  reminder_minutes_before: number;
}

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const SYNC_WINDOW_DAYS = 90; // sync events ±90 days from now
const MAX_EVENTS_PER_SYNC = 500; // safety limit per sync run
const REMINDER_DEFAULT_MINUTES = 15;

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Decrypts OAuth tokens using AES-256-GCM.
 * INV-17: токены хранятся зашифрованными, расшифровка только внутри Edge Functions.
 */
async function decryptOauthTokens(
  encrypted: Uint8Array,
  key: string
): Promise<OAuthTokens> {
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 bytes');
  }

  // Extract IV (first 12 bytes) and ciphertext (remaining)
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);

  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key.slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

/**
 * Encrypts OAuth tokens using AES-256-GCM.
 */
async function encryptOauthTokens(
  tokens: OAuthTokens,
  key: string
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(tokens));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key.slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plaintext
  );

  // Prepend IV to ciphertext for decryption later
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return result;
}

/**
 * Timing-safe comparison for service-to-service auth (A-2).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Formats date for CalDAV/Graph API queries.
 */
function formatDateForQuery(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Upserts a single calendar event into the database.
 */
async function upsertCalendarEvent(
  supabase: ReturnType<typeof createClient>,
  payload: CalendarEventPayload
): Promise<void> {
  await supabase
    .from('calendar_events')
    .upsert(
      {
        workspace_id: payload.workspace_id,
        provider: payload.provider,
        remote_event_id: payload.remote_event_id,
        title: payload.title.slice(0, 500),
        description: payload.description?.slice(0, 5000) ?? null,
        start_at: payload.start_at,
        end_at: payload.end_at,
        reminder_minutes_before: payload.reminder_minutes_before,
        source_synced_at: new Date().toISOString(),
      },
      {
        onConflict: 'workspace_id,provider,remote_event_id',
        ignoreDuplicates: false,
      }
    );
}

// ═══════════════════════════════════════════════════════
// Provider Adapters
// ═══════════════════════════════════════════════════════

/**
 * Yandex CalDAV adapter.
 * Uses tsdav-like HTTP requests for PROPFIND/REPORT CalDAV operations.
 */
async function syncYandex(
  supabase: ReturnType<typeof createClient>,
  connection: CalendarConnection,
  tokens: OAuthTokens
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    const now = new Date();
    const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Yandex CalDAV base URL
    const caldavUrl = `https://caldav.yandex.ru/calendars/${encodeURIComponent(connection.provider_account_email)}/`;

    // CalDAV REPORT query for VEVENTs in time range
    const reportXml = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop xmlns:D="DAV:">
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:time-range start="${formatDateForQuery(since)}" end="${formatDateForQuery(until)}"/>
  </C:filter>
</C:calendar-query>`;

    const response = await fetch(caldavUrl, {
      method: 'REPORT',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'text/xml; charset="utf-8"',
        Depth: '1',
      },
      body: reportXml,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Yandex CalDAV REPORT failed: ${response.status} ${errorText}`);
    }

    const responseBody = await response.text();

    // Parse iCal response (simplified XML parsing for MVP)
    // In production, use a proper iCal parser like ical.js
    const eventMatches = responseBody.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

    for (const eventBlock of eventMatches) {
      try {
        const uidMatch = eventBlock.match(/UID:(.+)$/m);
        const summaryMatch = eventBlock.match(/SUMMARY:(.+)$/m);
        const descriptionMatch = eventBlock.match(/DESCRIPTION:(.+)$/m);
        const dtStartMatch = eventBlock.match(/DTSTART[;:]([^,\n]+)/);
        const dtEndMatch = eventBlock.match(/DTEND[;:]([^,\n]+)/);

        if (!uidMatch || !dtStartMatch || !dtEndMatch) continue;

        const remoteId = uidMatch[1].trim();
        const title = summaryMatch ? summaryMatch[1].trim() : 'Без названия';
        const description = descriptionMatch
          ? descriptionMatch[1].replace(/\\n/g, '\n').replace(/\\\\/g, '\\').trim()
          : null;

        // Parse dates (handle both UTC and timezone-aware formats)
        const parseDate = (dateStr: string) => {
          const cleaned = dateStr.replace(/Z$/, '').replace(/[-:]/g, '');
          if (cleaned.length === 15) {
            // YYYYMMDDTHHMMSS
            return new Date(
              parseInt(cleaned.slice(0, 4)),
              parseInt(cleaned.slice(4, 6)) - 1,
              parseInt(cleaned.slice(6, 8)),
              parseInt(cleaned.slice(9, 11)),
              parseInt(cleaned.slice(11, 13)),
              parseInt(cleaned.slice(13, 15))
            ).toISOString();
          } else if (cleaned.length === 8) {
            // YYYYMMDD (all-day event)
            return new Date(
              parseInt(cleaned.slice(0, 4)),
              parseInt(cleaned.slice(4, 6)) - 1,
              parseInt(cleaned.slice(6, 8))
            ).toISOString();
          }
          return new Date(dateStr).toISOString();
        };

        const startAt = parseDate(dtStartMatch[1].trim());
        const endAt = parseDate(dtEndMatch[1].trim());

        await upsertCalendarEvent(supabase, {
          workspace_id: connection.workspace_id,
          provider: 'yandex',
          remote_event_id: remoteId,
          title,
          description,
          start_at: startAt,
          end_at: endAt,
          reminder_minutes_before: REMINDER_DEFAULT_MINUTES,
        });

        synced++;
      } catch (parseErr) {
        errors.push(`parse_error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`);
      }
    }
  } catch (syncErr) {
    errors.push(`sync_error: ${syncErr instanceof Error ? syncErr.message : 'unknown'}`);
  }

  return { synced, errors };
}

/**
 * Outlook Graph API adapter.
 * Uses /me/calendarView endpoint to fetch events.
 */
async function syncOutlook(
  supabase: ReturnType<typeof createClient>,
  connection: CalendarConnection,
  tokens: OAuthTokens
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    const now = new Date();
    const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Microsoft Graph API endpoint
    const graphUrl = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${formatDateForQuery(since)}&endDateTime=${formatDateForQuery(until)}&$top=${MAX_EVENTS_PER_SYNC}`;

    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Outlook Graph API failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const events = data.value || [];

    for (const event of events) {
      try {
        const startAt = new Date(event.start.dateTime || event.start.dateTime).toISOString();
        const endAt = new Date(event.end.dateTime || event.end.dateTime).toISOString();

        await upsertCalendarEvent(supabase, {
          workspace_id: connection.workspace_id,
          provider: 'outlook',
          remote_event_id: event.id,
          title: event.subject || event.title || 'Без названия',
          description: event.body?.content ?? null,
          start_at: startAt,
          end_at: endAt,
          reminder_minutes_before: REMINDER_DEFAULT_MINUTES,
        });

        synced++;
      } catch (parseErr) {
        errors.push(`parse_error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`);
      }
    }
  } catch (syncErr) {
    errors.push(`sync_error: ${syncErr instanceof Error ? syncErr.message : 'unknown'}`);
  }

  return { synced, errors };
}

// ═══════════════════════════════════════════════════════
// OAuth Token Exchange Helpers
// ═══════════════════════════════════════════════════════

/**
 * Exchange authorization code for Yandex OAuth tokens.
 * 
 * POST https://oauth.yandex.ru/token
 * Body: client_id=...&client_secret=...&code=...&grant_type=authorization_code
 */
async function exchangeYandexTokens(
  code: string,
  _encryptionKey: string // kept for future secret rotation
): Promise<OAuthTokens> {
  const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('YANDEX_OAUTH_CLIENT_SECRET') || '';
  const redirectUri = `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:3000'}/api/calendar/callback/yandex`;

  if (!clientId || !clientSecret) {
    throw new Error('YANDEX_OAUTH_CLIENT_ID and YANDEX_OAUTH_CLIENT_SECRET must be configured');
  }

  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
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
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

/**
 * Exchange authorization code for Outlook Graph API tokens.
 * 
 * POST https://login.microsoftonline.com/common/oauth2/v2.0/token
 * Body: client_id=...&scope=...&code=...&grant_type=authorization_code&redirect_uri=...
 */
async function exchangeOutlookTokens(
  code: string,
  _encryptionKey: string // kept for future secret rotation
): Promise<OAuthTokens> {
  const clientId = Deno.env.get('OUTLOOK_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('OUTLOOK_OAUTH_CLIENT_SECRET') || '';
  const redirectUri = `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:3000'}/api/calendar/callback/outlook`;

  if (!clientId || !clientSecret) {
    throw new Error('OUTLOOK_OAUTH_CLIENT_ID and OUTLOOK_OAUTH_CLIENT_SECRET must be configured');
  }

  const response = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: 'Cal.Read offline_access',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        client_secret: clientSecret,
      }).toString(),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Outlook token exchange failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error('Outlook token exchange returned no access_token');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

/**
 * Get Yandex account email using user info API.
 */
async function getYandexAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://login.yandex.ru/info?format=json', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Yandex get account email failed: ${response.status}`);
  }

  const data = await response.json() as { email?: string };
  if (!data.email) {
    throw new Error('Yandex returned no email in user info');
  }

  return data.email;
}

/**
 * Get Outlook account email using Microsoft Graph /me endpoint.
 */
async function getOutlookAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/$select=id,displayName,userPrincipalName', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Outlook get account email failed: ${response.status}`);
  }

  const data = await response.json() as { userPrincipalName?: string; displayName?: string };
  if (!data.userPrincipalName) {
    throw new Error('Outlook returned no userPrincipalName');
  }

  return data.userPrincipalName;
}

/**
 * Refresh Yandex OAuth tokens using refresh_token.
 * 
 * POST https://oauth.yandex.ru/token
 * Body: client_id=...&client_secret=...&refresh_token=...&grant_type=refresh_token
 */
async function refreshYandexTokens(
  refreshToken: string,
  encryptionKey: string
): Promise<OAuthTokens> {
  const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('YANDEX_OAUTH_CLIENT_SECRET') || '';

  if (!clientId || !clientSecret) {
    throw new Error('YANDEX_OAUTH_CLIENT_ID and YANDEX_OAUTH_CLIENT_SECRET must be configured');
  }

  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Yandex token refresh failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error('Yandex token refresh returned no access_token');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // Yandex may return same refresh_token
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

/**
 * Refresh Outlook OAuth tokens using refresh_token.
 * 
 * POST https://login.microsoftonline.com/common/oauth2/v2.0/token
 */
async function refreshOutlookTokens(
  refreshToken: string,
  encryptionKey: string
): Promise<OAuthTokens> {
  const clientId = Deno.env.get('OUTLOOK_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('OUTLOOK_OAUTH_CLIENT_SECRET') || '';

  if (!clientId || !clientSecret) {
    throw new Error('OUTLOOK_OAUTH_CLIENT_ID and OUTLOOK_OAUTH_CLIENT_SECRET must be configured');
  }

  const response = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: 'Cal.Read offline_access',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_secret: clientSecret,
      }).toString(),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Outlook token refresh failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error('Outlook token refresh returned no access_token');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

// ═══════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════

serve(async (req: Request) => {
  try {
    // ── 1. Initialize Supabase client (service role) ────────
    const supabaseUrl = Deno.env.get('SB_URL') || '';
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY') || '';
    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase credentials not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!encryptionKey) {
      return new Response(
        JSON.stringify({ error: 'ENCRYPTION_KEY not configured (INV-17)' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 2. Authenticate request ────────────────────────────
    // Accept either service key (internal cron/webhook) or user JWT
    const authHeader = req.headers.get('Authorization') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_KEY') || '';

    if (serviceKey && timingSafeEqual(authHeader, `Bearer ${serviceKey}`)) {
      // Service-to-service auth (pg_cron fallback, webhook)
    } else if (authHeader.startsWith('Bearer ') && authHeader.length > 10) {
      // User JWT — validate via Supabase (simplified check for MVP)
      // In production, verify JWT signature and extract user ID
    } else {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── 3. Parse request body ──────────────────────────────
    const body = await req.json();
    const { workspace_id, provider, action = 'sync' } = body as {
      workspace_id?: string;
      provider?: 'yandex' | 'outlook';
      action?: 'sync' | 'connect' | 'disconnect';
    };

    if (!workspace_id || !provider) {
      return new Response(
        JSON.stringify({ error: 'workspace_id and provider are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['yandex', 'outlook'].includes(provider)) {
      return new Response(
        JSON.stringify({ error: 'Invalid provider. Must be yandex or outlook.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── 4. Handle actions ──────────────────────────────────
    if (action === 'connect') {
      // OAuth callback: exchange code for tokens, encrypt, save
      const { code, worker_id, provider_account_email } = body as {
        code?: string;
        worker_id?: string;
        provider_account_email?: string;
      };

      if (!code) {
        return new Response(
          JSON.stringify({ error: 'authorization_code required for connect action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!worker_id) {
        return new Response(
          JSON.stringify({ error: 'worker_id required for connect action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 1: Exchange authorization code for tokens
      let tokens: OAuthTokens;
      try {
        if (provider === 'yandex') {
          tokens = await exchangeYandexTokens(code, encryptionKey);
        } else {
          tokens = await exchangeOutlookTokens(code, encryptionKey);
        }
      } catch (tokenErr) {
        console.error(`calendar_sync: token exchange failed for ${provider}`, tokenErr);
        return new Response(
          JSON.stringify({
            error: 'token_exchange_failed',
            details: tokenErr instanceof Error ? tokenErr.message : 'unknown',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 2: Get or create connection record
      // First, check if a connection already exists for this workspace+worker+provider
      const { data: existingConnection } = await supabase
        .from('calendar_connections')
        .select('id, provider_account_email')
        .eq('workspace_id', workspace_id)
        .eq('worker_id', worker_id)
        .eq('provider', provider)
        .maybeSingle();

      // Determine account email: from body, from existing connection, or from token introspection
      let accountEmail = provider_account_email;
      if (!accountEmail && existingConnection) {
        accountEmail = existingConnection.provider_account_email;
      }

      if (!accountEmail) {
        // Try to get email from provider API
        try {
          if (provider === 'yandex') {
            accountEmail = await getYandexAccountEmail(tokens.access_token);
          } else {
            accountEmail = await getOutlookAccountEmail(tokens.access_token);
          }
        } catch (emailErr) {
          console.error(`calendar_sync: failed to get account email`, emailErr);
          accountEmail = `${provider}_user`;
        }
      }

      // Step 3: Encrypt tokens
      const encryptedTokens = await encryptOauthTokens(tokens, encryptionKey);

      // Step 4: Upsert connection record
      const now = new Date().toISOString();
      const expiresAt = new Date(tokens.expires_at * 1000).toISOString();

      if (existingConnection) {
        // Update existing connection
        await supabase
          .from('calendar_connections')
          .update({
            encrypted_oauth_tokens: encryptedTokens,
            token_expires_at: expiresAt,
            is_active: true,
            last_sync_at: null, // Reset sync status on re-connect
          })
          .eq('id', existingConnection.id);
      } else {
        // Create new connection
        const { error: insertError } = await supabase
          .from('calendar_connections')
          .insert({
            workspace_id,
            worker_id,
            provider,
            provider_account_email: accountEmail,
            encrypted_oauth_tokens: encryptedTokens,
            token_expires_at: expiresAt,
            is_active: true,
            connected_at: now,
          });

        if (insertError) {
          console.error('calendar_sync: connection insert error', insertError);
          return new Response(
            JSON.stringify({ error: 'connection_save_failed', details: insertError }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Step 5: Trigger initial sync
      let syncResult: { synced: number; errors: string[] };
      try {
        if (provider === 'yandex') {
          syncResult = await syncYandex(supabase, {
            id: existingConnection?.id || '',
            workspace_id,
            worker_id,
            provider,
            provider_account_email: accountEmail,
            encrypted_oauth_tokens: encryptedTokens,
            token_expires_at: expiresAt,
            is_active: true,
            last_sync_at: null,
          } as CalendarConnection, tokens);
        } else {
          syncResult = await syncOutlook(supabase, {
            id: existingConnection?.id || '',
            workspace_id,
            worker_id,
            provider,
            provider_account_email: accountEmail,
            encrypted_oauth_tokens: encryptedTokens,
            token_expires_at: expiresAt,
            is_active: true,
            last_sync_at: null,
          } as CalendarConnection, tokens);
        }
      } catch (syncErr) {
        console.error('calendar_sync: initial sync failed', syncErr);
        syncResult = { synced: 0, errors: [syncErr instanceof Error ? syncErr.message : 'unknown'] };
      }

      return new Response(
        JSON.stringify({
          message: 'Calendar connected successfully',
          provider,
          synced: syncResult.synced,
          errors: syncResult.errors.length > 0 ? syncResult.errors : undefined,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'disconnect') {
      // Deactivate connection
      const { worker_id } = body as { worker_id?: string };
      if (!worker_id) {
        return new Response(
          JSON.stringify({ error: 'worker_id required for disconnect action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: updateError } = await supabase
        .from('calendar_connections')
        .update({ is_active: false })
        .eq('workspace_id', workspace_id)
        .eq('worker_id', worker_id)
        .eq('provider', provider);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: 'disconnect_failed', details: updateError }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ message: 'Calendar disconnected' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── 5. Sync action ─────────────────────────────────────
    // Fetch active connection
    const { data: connection, error: connError } = await supabase
      .from('calendar_connections')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('provider', provider)
      .eq('is_active', true)
      .maybeSingle() as { data: CalendarConnection | null; error: unknown };

    if (connError) {
      console.error('calendar_sync: connection fetch error', connError);
      return new Response(
        JSON.stringify({ error: 'connection_fetch_failed', details: connError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!connection) {
      return new Response(
        JSON.stringify({ error: 'no_active_connection', hint: 'Connect calendar first via OAuth flow' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check token expiry — attempt refresh before giving up
    // Refresh threshold: 5 minutes before actual expiry
    const now = Math.floor(Date.now() / 1000);
    const tokenExpiryMs = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
    const needsRefresh = tokenExpiryMs > 0 && (now + 300) > (tokenExpiryMs / 1000);

    let tokens: OAuthTokens;

    if (needsRefresh) {
      // Token is expired or about to expire — try to refresh
      console.log(`calendar_sync: token expiring soon, attempting refresh for ${provider}`);

      try {
        // Decrypt to get refresh_token
        const decrypted = await decryptOauthTokens(connection.encrypted_oauth_tokens, encryptionKey);

        if (!decrypted.refresh_token) {
          throw new Error('No refresh_token available');
        }

        // Exchange refresh_token for new access_token
        let refreshedTokens: OAuthTokens;
        if (provider === 'yandex') {
          refreshedTokens = await refreshYandexTokens(decrypted.refresh_token, encryptionKey);
        } else {
          refreshedTokens = await refreshOutlookTokens(decrypted.refresh_token, encryptionKey);
        }

        // Encrypt and save new tokens
        const newEncrypted = await encryptOauthTokens(refreshedTokens, encryptionKey);
        const newExpiresAt = new Date(refreshedTokens.expires_at * 1000).toISOString();

        await supabase
          .from('calendar_connections')
          .update({
            encrypted_oauth_tokens: newEncrypted,
            token_expires_at: newExpiresAt,
          })
          .eq('id', connection.id);

        tokens = refreshedTokens;
        console.log(`calendar_sync: token refreshed successfully for ${provider}`);
      } catch (refreshErr) {
        console.error(`calendar_sync: token refresh failed for ${provider}`, refreshErr);
        return new Response(
          JSON.stringify({
            error: 'token_refresh_failed',
            hint: 'Re-authenticate calendar account',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Token is still valid — decrypt normally
      try {
        tokens = await decryptOauthTokens(connection.encrypted_oauth_tokens, encryptionKey);
      } catch (decryptErr) {
        console.error('calendar_sync: decryption failed', decryptErr);
        return new Response(
          JSON.stringify({ error: 'token_decryption_failed' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Route to provider-specific sync
    let result: { synced: number; errors: string[] };
    if (provider === 'yandex') {
      result = await syncYandex(supabase, connection, tokens);
    } else {
      result = await syncOutlook(supabase, connection, tokens);
    }

    // Update last_sync_at
    await supabase
      .from('calendar_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', connection.id);

    // Return result
    const response: Record<string, unknown> = {
      message: 'Calendar synced successfully',
      provider,
      synced: result.synced,
    };

    if (result.errors.length > 0) {
      response.errors = result.errors;
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('calendar_sync: unexpected error', err);
    return new Response(
      JSON.stringify({
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});