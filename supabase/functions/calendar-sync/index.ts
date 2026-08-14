/**
 * Supabase Edge Function: calendar_sync
 *
 * Модуль «Календарь» v0.17.0 — синхронизация событий из Yandex CalDAV.
 *
 * Архитектура:
 * - OAuth flow (authorization code): пользователь авторизуется через Yandex
 *   → код обмена на access_token + refresh_token
 *   → шифрование AES-256-GCM → сохранение как base64 text в oauth_tokens_b64
 * - Синхронизация: дешифрование токенов → auto-refresh если истёк → fetch событий
 * - CalDAV использует Authorization: OAuth <token> для REPORT запросов
 * - Все вызовы к внешним API — Cold Path в Supabase Edge Functions (A-1)
 *
 * Изменение v0.17.0: 
 * - authorization code flow вместо implicit grant
 * - auto-refresh токенов перед синхронизацией
 * - детальное логирование для диагностики 401
 *
 * Master Spec §6.19, onitask_calendar_.md §4
 */

// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface CalendarConnection {
  id: string;
  profile_id: string;
  provider: 'yandex';
  provider_account_email: string;
  oauth_tokens_b64: string;
  token_expires_at: string | null;
  is_active: boolean;
  last_sync_at: string | null;
}

interface CalendarEventPayload {
  profile_id: string;
  provider: 'yandex';
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

const SYNC_WINDOW_DAYS = 90;
const REMINDER_DEFAULT_MINUTES = 15;

// ═══════════════════════════════════════════════════════
// AES-256-GCM шифрование/дешифрование
// Формат хранения: IV (12 bytes) || ciphertext (GCM auth tag implicit)
// В БД: base64(IV || ciphertext)
// ═══════════════════════════════════════════════════════

function normalizeEncryptionKey(key: string): Uint8Array {
  const trimmed = key.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  const encoder = new TextEncoder();
  const encoded = encoder.encode(trimmed);
  if (encoded.length >= 32) return encoded.slice(0, 32);
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return padded;
}

async function decryptOauthTokens(tokensB64: string, key: string): Promise<OAuthTokens> {
  if (!key || key.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 bytes');
  
  const binaryString = atob(tokensB64.trim());
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  
  if (bytes.length < 28) throw new Error(`Encrypted data too short: ${bytes.length} bytes`);
  
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  
  const rawKey = normalizeEncryptionKey(key);
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function encryptOauthTokens(tokens: OAuthTokens, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(tokens));
  const rawKey = normalizeEncryptionKey(key);
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext);
  
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  
  let binary = '';
  for (let i = 0; i < result.byteLength; i++) binary += String.fromCharCode(result[i]);
  return btoa(binary);
}

// ═══════════════════════════════════════════════════════
// Утилиты
// ═══════════════════════════════════════════════════════

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function formatDateForQuery(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function upsertCalendarEvent(supabase: ReturnType<typeof createClient>, payload: CalendarEventPayload): Promise<void> {
  await supabase.from('calendar_events').upsert({
    profile_id: payload.profile_id, provider: payload.provider, remote_event_id: payload.remote_event_id,
    title: payload.title.slice(0, 500), description: payload.description?.slice(0, 5000) ?? null,
    start_at: payload.start_at, end_at: payload.end_at,
    reminder_minutes_before: payload.reminder_minutes_before, source_synced_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,provider,remote_event_id', ignoreDuplicates: false });
}

/**
 * Sync events from Yandex CalDAV using OAuth token.
 * 
 * Yandex CalDAV accepts Authorization: OAuth <token> for REPORT requests.
 * The www-authenticate: Basic realm="CalDAV" header indicates supported auth methods,
 * but OAuth token also works as documented at https://yandex.ru/dev/caldav/
 */
async function syncYandex(supabase: ReturnType<typeof createClient>, connection: CalendarConnection, tokens: OAuthTokens): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = []; let synced = 0;
  try {
    console.log('calendar_sync: starting Yandex CalDAV sync for', connection.provider_account_email);
    
    const now = new Date();
    const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const caldavUrl = `https://caldav.yandex.ru/calendars/${encodeURIComponent(connection.provider_account_email)}/`;
    
    console.log('calendar_sync: CalDAV URL =', caldavUrl);
    console.log('calendar_sync: time range =', since.toISOString(), 'to', until.toISOString());
    console.log('calendar_sync: access_token prefix =', tokens.access_token?.substring(0, 20) + '...');
    console.log('calendar_sync: has_refresh_token =', !!tokens.refresh_token);
    console.log('calendar_sync: token_expires_at =', new Date(tokens.expires_at * 1000).toISOString());
    
    const reportXml = `<?xml version="1.0" encoding="utf-8" ?><C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop xmlns:D="DAV:"><C:calendar-data/></D:prop><C:filter><C:time-range start="${formatDateForQuery(since)}" end="${formatDateForQuery(until)}"/></C:filter></C:calendar-query>`;
    
    const response = await fetch(caldavUrl, { 
      method: 'REPORT', 
      headers: { 
        Authorization: `OAuth ${tokens.access_token}`, 
        'Content-Type': 'application/xml; charset=utf-8', 
        Depth: '1' 
      }, 
      body: reportXml 
    });
    
    console.log('calendar_sync: REPORT response status =', response.status);
    console.log('calendar_sync: REPORT response headers =', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('calendar_sync: REPORT response body =', responseText.substring(0, 2000));
    
    if (!response.ok) { 
      console.error('calendar_sync: REPORT error details:', {
        status: response.status,
        statusText: response.statusText,
        body: responseText.substring(0, 2000),
        auth_method: 'OAuth',
        token_prefix: tokens.access_token?.substring(0, 30) + '...',
        has_refresh: !!tokens.refresh_token,
      });
      throw new Error(`Yandex CalDAV REPORT failed: ${response.status} ${responseText.substring(0, 500)}`); 
    }
    
    const eventMatches = responseText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
    console.log('calendar_sync: found', eventMatches.length, 'VEVENT blocks');
    
    for (let i = 0; i < eventMatches.length; i++) {
      const eventBlock = eventMatches[i];
      try {
        const uidMatch = eventBlock.match(/UID:(.+)$/m);
        const summaryMatch = eventBlock.match(/SUMMARY:(.+)$/m);
        const descriptionMatch = eventBlock.match(/DESCRIPTION:(.+)$/m);
        const dtStartMatch = eventBlock.match(/DTSTART[;:]([^,\n]+)/);
        const dtEndMatch = eventBlock.match(/DTEND[;:]([^,\n]+)/);
        
        if (!uidMatch || !dtStartMatch || !dtEndMatch) continue;
        
        const remoteId = uidMatch[1].trim();
        const title = summaryMatch ? summaryMatch[1].trim() : 'No title';
        const description = descriptionMatch ? descriptionMatch[1].replace(/\\n/g, '\n').replace(/\\\\/g, '\\').trim() : null;
        
        const parseDate = (dateStr: string) => {
          const cleaned = dateStr.replace(/Z$/, '').replace(/[-:]/g, '');
          if (cleaned.length === 15) return new Date(
            parseInt(cleaned.slice(0,4)), parseInt(cleaned.slice(4,6))-1,
            parseInt(cleaned.slice(6,8)), parseInt(cleaned.slice(9,11)),
            parseInt(cleaned.slice(11,13)), parseInt(cleaned.slice(13,15))
          ).toISOString();
          if (cleaned.length === 8) return new Date(
            parseInt(cleaned.slice(0,4)), parseInt(cleaned.slice(4,6))-1,
            parseInt(cleaned.slice(6,8))
          ).toISOString();
          return new Date(dateStr).toISOString();
        };
        
        const startAt = parseDate(dtStartMatch[1].trim());
        const endAt = parseDate(dtEndMatch[1].trim());
        
        await upsertCalendarEvent(supabase, { 
          profile_id: connection.profile_id, provider: 'yandex',
          remote_event_id: remoteId, title, description,
          start_at: startAt, end_at: endAt,
          reminder_minutes_before: REMINDER_DEFAULT_MINUTES 
        });
        synced++;
      } catch (parseErr) { 
        errors.push(`parse_error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`); 
      }
    }
    
    console.log('calendar_sync: sync complete. synced =', synced, 'errors =', errors.length);
  } catch (syncErr) { 
    errors.push(`sync_error: ${syncErr instanceof Error ? syncErr.message : 'unknown'}`); 
    console.error('calendar_sync: sync error', syncErr);
  }
  return { synced, errors };
}

async function exchangeYandexTokens(code: string): Promise<OAuthTokens> {
  const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('YANDEX_OAUTH_CLIENT_SECRET') || '';
  const redirectUri = `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:3000'}/api/calendar/callback/yandex`;
  if (!clientId || !clientSecret) throw new Error('YANDEX_OAUTH_CLIENT_ID and YANDEX_OAUTH_CLIENT_SECRET must be configured');
  
  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/x-www-form-urlencoded', 
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` 
    },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString(),
  });
  
  if (!response.ok) { const errorText = await response.text(); throw new Error(`Yandex token exchange failed: ${response.status} ${errorText}`); }
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Yandex token exchange returned no access_token');
  return { access_token: data.access_token, refresh_token: data.refresh_token || '', expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) };
}

async function getYandexAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://login.yandex.ru/info?format=json', { 
    headers: { Authorization: `Bearer ${accessToken}` } 
  });
  if (!response.ok) throw new Error(`Yandex get account email failed: ${response.status}`);
  const data = await response.json() as { email?: string };
  if (!data.email) throw new Error('Yandex returned no email in user info');
  return data.email;
}

async function refreshYandexTokens(refreshToken: string): Promise<OAuthTokens> {
  const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('YANDEX_OAUTH_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) throw new Error('YANDEX_OAUTH_CLIENT_ID and YANDEX_OAUTH_CLIENT_SECRET must be configured');
  
  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/x-www-form-urlencoded', 
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` 
    },
    body: new URLSearchParams({ refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  });
  
  if (!response.ok) { const errorText = await response.text(); throw new Error(`Yandex token refresh failed: ${response.status} ${errorText}`); }
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Yandex token refresh returned no access_token');
  return { access_token: data.access_token, refresh_token: data.refresh_token || refreshToken, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) };
}

// ═══════════════════════════════════════════════════════
// Edge Function handler
// ═══════════════════════════════════════════════════════

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SB_URL') || '';
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY') || '';
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Supabase credentials not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (!encryptionKey) {
      return new Response(JSON.stringify({ error: 'ENCRYPTION_KEY not configured (INV-17)' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const authHeader = req.headers.get('Authorization') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_KEY') || '';
    if (!(serviceKey && timingSafeEqual(authHeader, `Bearer ${serviceKey}`)) && !(authHeader.startsWith('Bearer ') && authHeader.length > 10)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const body = await req.json();
    const { profile_id, provider, action = 'sync' } = body as { profile_id?: string; provider?: 'yandex'; action?: 'sync' | 'connect' | 'disconnect' };
    console.log('calendar_sync: action=', action, 'profile_id=', profile_id, 'provider=', provider);
    
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!provider) return new Response(JSON.stringify({ error: 'provider is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (provider !== 'yandex') return new Response(JSON.stringify({ error: 'Invalid provider. Must be yandex.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    // ═══ Connect action ═══
    if (action === 'connect') {
      const { code, access_token: incomingToken, provider_account_email } = body as { code?: string; access_token?: string; provider_account_email?: string };
      let tokens: OAuthTokens;
      
      if (incomingToken) {
        console.log('calendar_sync: implicit token flow (deprecated)');
        tokens = { access_token: incomingToken, refresh_token: '', expires_at: Math.floor(Date.now() / 1000) + 3600 };
      } else if (code) {
        console.log('calendar_sync: authorization code flow');
        try { tokens = await exchangeYandexTokens(code); }
        catch (tokenErr) { 
          return new Response(JSON.stringify({ error: 'token_exchange_failed', details: tokenErr instanceof Error ? tokenErr.message : 'unknown' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); 
        }
      } else {
        return new Response(JSON.stringify({ error: 'code or access_token required for connect action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      
      const { data: existingConnection } = await supabase
        .from('calendar_connections')
        .select('id, provider_account_email')
        .eq('profile_id', profile_id)
        .eq('provider', provider)
        .maybeSingle();
      
      let accountEmail = provider_account_email;
      if (!accountEmail && existingConnection) accountEmail = existingConnection.provider_account_email;
      if (!accountEmail) { 
        try { accountEmail = await getYandexAccountEmail(tokens.access_token); } 
        catch { accountEmail = 'yandex_user'; } 
      }
      
      const encryptedB64 = await encryptOauthTokens(tokens, encryptionKey);
      const now = new Date().toISOString();
      const expiresAt = new Date(tokens.expires_at * 1000).toISOString();
      
      if (existingConnection) {
        await supabase.from('calendar_connections')
          .update({ oauth_tokens_b64: encryptedB64, token_expires_at: expiresAt, is_active: true, last_sync_at: null })
          .eq('id', existingConnection.id);
      } else {
        const { error: insertError } = await supabase.from('calendar_connections').insert({ 
          profile_id, provider, provider_account_email: accountEmail, 
          oauth_tokens_b64: encryptedB64, token_expires_at: expiresAt, 
          is_active: true, connected_at: now 
        });
        if (insertError) { 
          console.error('calendar_sync: connection insert error', insertError); 
          return new Response(JSON.stringify({ error: 'connection_save_failed', details: insertError }), { status: 500, headers: { 'Content-Type': 'application/json' } }); 
        }
      }
      
      let syncResult: { synced: number; errors: string[] };
      try {
        syncResult = await syncYandex(supabase, { 
          id: existingConnection?.id || '', profile_id, provider, 
          provider_account_email: accountEmail, oauth_tokens_b64: encryptedB64,
          token_expires_at: expiresAt, is_active: true, last_sync_at: null 
        } as CalendarConnection, tokens);
      } catch (syncErr) { 
        console.error('calendar_sync: initial sync failed', syncErr); 
        syncResult = { synced: 0, errors: [syncErr instanceof Error ? syncErr.message : 'unknown'] }; 
      }
      
      return new Response(JSON.stringify({ 
        message: 'Calendar connected successfully', provider, 
        synced: syncResult.synced, 
        errors: syncResult.errors.length > 0 ? syncResult.errors : undefined 
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ═══ Disconnect action ═══
    if (action === 'disconnect') {
      const { error: updateError } = await supabase.from('calendar_connections')
        .update({ is_active: false })
        .eq('profile_id', profile_id)
        .eq('provider', provider);
      if (updateError) return new Response(JSON.stringify({ error: 'disconnect_failed', details: updateError }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ message: 'Calendar disconnected' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ═══ Sync action ═══
    const { data: connection, error: connError } = await supabase
      .from('calendar_connections')
      .select('id,profile_id,provider,provider_account_email,oauth_tokens_b64,token_expires_at,is_active,last_sync_at')
      .eq('profile_id', profile_id)
      .eq('provider', provider)
      .eq('is_active', true)
      .maybeSingle() as { data: CalendarConnection | null; error: unknown };
    
    if (connError) { 
      console.error('calendar_sync: connection fetch error', connError); 
      return new Response(JSON.stringify({ error: 'connection_fetch_failed', details: connError }), { status: 500, headers: { 'Content-Type': 'application/json' } }); 
    }
    if (!connection) {
      return new Response(JSON.stringify({ error: 'no_active_connection', hint: 'Connect calendar first via OAuth flow' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // Auto-refresh token if needed
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tokenExpirySeconds = connection.token_expires_at ? Math.floor(new Date(connection.token_expires_at).getTime() / 1000) : 0;
    const needsRefresh = tokenExpirySeconds > 0 && (nowSeconds + 300) > tokenExpirySeconds;
    let tokens: OAuthTokens;

    if (needsRefresh) {
      console.log('calendar_sync: token expiring soon, attempting refresh');
      try {
        const decrypted = await decryptOauthTokens(connection.oauth_tokens_b64, encryptionKey);
        if (!decrypted.refresh_token) {
          console.error('calendar_sync: no refresh_token available, requires re-auth');
          return new Response(JSON.stringify({ 
            error: 'token_refresh_failed', 
            hint: 'Re-connect your calendar account to get a refresh_token.',
            details: 'The stored token was obtained without refresh_token (implicit grant). Please reconnect via the updated OAuth flow.'
          }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        const refreshedTokens = await refreshYandexTokens(decrypted.refresh_token);
        const newEncryptedB64 = await encryptOauthTokens(refreshedTokens, encryptionKey);
        const newExpiresAt = new Date(refreshedTokens.expires_at * 1000).toISOString();
        await supabase.from('calendar_connections')
          .update({ oauth_tokens_b64: newEncryptedB64, token_expires_at: newExpiresAt })
          .eq('id', connection.id);
        tokens = refreshedTokens;
        console.log('calendar_sync: token refreshed successfully');
      } catch (refreshErr) {
        console.error('calendar_sync: token refresh failed', refreshErr);
        return new Response(JSON.stringify({ error: 'token_refresh_failed', hint: 'Re-authenticate calendar account' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    } else {
      try {
        tokens = await decryptOauthTokens(connection.oauth_tokens_b64, encryptionKey);
        console.log('calendar_sync: tokens decrypted, has_refresh_token=', !!tokens.refresh_token);
      } catch (decryptErr) {
        console.error('calendar_sync: decryption failed', decryptErr);
        return new Response(JSON.stringify({ 
          error: 'token_decryption_failed', 
          hint: 'Re-connect your calendar account.', 
          details: decryptErr instanceof Error ? decryptErr.message : 'unknown'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const result = await syncYandex(supabase, connection, tokens);
    await supabase.from('calendar_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', connection.id);
    
    const response: Record<string, unknown> = { 
      message: 'Calendar synced successfully', provider, 
      synced: result.synced 
    };
    if (result.errors.length > 0) response.errors = result.errors;
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('calendar_sync: unexpected error', err);
    return new Response(JSON.stringify({ error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});