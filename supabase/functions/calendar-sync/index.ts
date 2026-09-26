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
 *
 * ВНИМАНИЕ v0.18.0 (2026-09-26): CalDAV-синхронизация ЗАБЛОКИРОВАНА.
 * Проверено прямым экспериментом (probe): caldav.yandex.ru отвечает
 * 401 + `www-authenticate: Basic realm="CalDAV"` на ВСЕ варианты с OAuth
 * токеном — bearer, токен как пароль, на /calendars/<login>/ и
 * /principals/users/<login>/, а также на PROPFIND корня. Яндекс CalDAV
 * требует app password (Яндекс ID → Пароли приложений → тип «Календарь»).
 * См. docs/TASKS.md CAL-07.
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

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

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

const CALDAV_BLOCKED = 'yandex_caldav_requires_app_password';

/**
 * Sync events from Yandex CalDAV — BLOCKED as of v0.18.0.
 *
 * Measured against the live server on 2026-09-26: caldav.yandex.ru answers
 * 401 with `www-authenticate: Basic realm="CalDAV"` to every auth shape an
 * OAuth token can produce (bearer header, token as Basic password) on both
 * /calendars/<login>/ and /principals/users/<login>/, and to PROPFIND on the
 * account root. Yandex CalDAV accepts app passwords only, so the token flow
 * cannot read events at all.
 *
 * A typed error beats a silent `synced: 0` on purpose: the UI must be able to
 * say "app password required" instead of an empty calendar forever. Restoring
 * real sync is CAL-07 in docs/TASKS.md.
 */
async function syncYandex(supabase: ReturnType<typeof createClient>, connection: CalendarConnection, tokens: OAuthTokens): Promise<{ synced: number; errors: string[] }> {
  console.error(`calendar_sync: sync blocked (${CALDAV_BLOCKED}) for`, connection.provider_account_email);
  return { synced: 0, errors: [CALDAV_BLOCKED] };
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

/**
 * Yandex returns `login` for a token without the login:email scope and
 * `email` when it is granted. Accept both so this keeps working either way.
 */
async function getYandexAccountLogin(accessToken: string): Promise<string> {
  const response = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Yandex get account info failed: ${response.status}`);
  const data = await response.json() as { login?: string; email?: string; default_email?: string };
  const account = data.login || data.default_email || data.email;
  if (!account) throw new Error('Yandex returned no login or email in user info');
  return account;
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
      const { 
        code, 
        access_token: incomingAccessToken, 
        refresh_token: incomingRefreshToken,
        expires_at: incomingExpiresAt,
        provider_account_email 
      } = body as { 
        code?: string; 
        access_token?: string; 
        refresh_token?: string;
        expires_at?: number;
        provider_account_email?: string 
      };
      
      let tokens: OAuthTokens;
      
      // Case 1: Direct tokens from verify-code endpoint
      if (incomingAccessToken) {
        console.log('calendar_sync: direct token flow from verify-code');
        tokens = { 
          access_token: incomingAccessToken, 
          refresh_token: incomingRefreshToken || '', 
          expires_at: incomingExpiresAt || Math.floor(Date.now() / 1000) + 3600 
        };
      } 
      // Case 2: Authorization code flow (legacy / direct call)
      else if (code) {
        console.log('calendar_sync: authorization code flow');
        try { tokens = await exchangeYandexTokens(code); }
        catch (tokenErr) { 
          return new Response(JSON.stringify({ error: 'token_exchange_failed', details: tokenErr instanceof Error ? tokenErr.message : 'unknown' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); 
        }
      } 
      else {
        return new Response(JSON.stringify({ error: 'access_token or code required for connect action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      
      const { data: existingConnection } = await supabase
        .from('calendar_connections')
        .select('id, provider_account_email')
        .eq('profile_id', profile_id)
        .eq('provider', provider)
        .maybeSingle();
      
      // Resolve the account. Never fall back to a placeholder: a fake login
      // silently produced an invalid CalDAV URL and a confusing 401.
      let accountEmail = provider_account_email;
      if (!accountEmail && existingConnection && existingConnection.provider_account_email !== 'yandex_user') {
        accountEmail = existingConnection.provider_account_email;
      }
      if (!accountEmail) {
        try { accountEmail = await getYandexAccountLogin(tokens.access_token); }
        catch (err) {
          console.error('calendar_sync: could not resolve Yandex account login', err);
          return new Response(JSON.stringify({
            error: 'account_login_unresolved',
            details: err instanceof Error ? err.message : 'unknown',
          }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }
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

    const response: Record<string, unknown> = {
      message: result.errors.includes(CALDAV_BLOCKED) ? 'Calendar sync unavailable' : 'Calendar synced successfully',
      provider,
      synced: result.synced
    };
    if (result.errors.length > 0) response.errors = result.errors;
    if (result.errors.includes(CALDAV_BLOCKED)) response.error = CALDAV_BLOCKED;
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('calendar_sync: unexpected error', err);
    return new Response(JSON.stringify({ error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});