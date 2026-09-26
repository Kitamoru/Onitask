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
 * v0.19.0 (2026-09-26, CAL-07): синхронизация переведена на **app password**.
 * OAuth-токен в CalDAV не работает — проверено прямым экспериментом против
 * живого caldav.yandex.ru: 401 + `www-authenticate: Basic realm="CalDAV"` на
 * bearer, на токен как пароль Basic, на обоих форматах пути и на PROPFIND корня.
 * REST-альтернативы тоже нет (404 / DNS / TLS на calendar.yandex.*).
 * CalDAV = HTTP Basic (логин + app password), логин резолвится из OAuth-токена.
 * Пароль шифруется тем же AES-256-GCM (INV-17) и хранится в
 * calendar_connections.caldav_password_b64; наружу не отдаётся никогда.
 *
 * OAuth-токен по-прежнему нужен и обновляется автоматически: он идентифицирует
 * аккаунт (даёт логин) и избавляет от повторной авторизации.
 */

// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseVEvents, type ParsedEvent } from './ical.ts';

interface CalendarConnection {
  id: string;
  profile_id: string;
  provider: 'yandex';
  provider_account_email: string;
  oauth_tokens_b64: string;
  caldav_password_b64?: string | null;
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
  is_all_day: boolean;
  reminder_minutes_before: number;
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

/** Encrypts an arbitrary secret string. INV-17: never leaves the Edge Function. */
async function encryptSecret(plaintext: string, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', normalizeEncryptionKey(key), { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(plaintext));

  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);

  let binary = '';
  for (let i = 0; i < result.byteLength; i++) binary += String.fromCharCode(result[i]);
  return btoa(binary);
}

async function decryptSecret(tokensB64: string, key: string): Promise<string> {
  if (!key || key.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 bytes');

  const binaryString = atob(tokensB64.trim());
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  if (bytes.length < 28) throw new Error(`Encrypted data too short: ${bytes.length} bytes`);

  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);

  const cryptoKey = await crypto.subtle.importKey('raw', normalizeEncryptionKey(key), { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function decryptOauthTokens(tokensB64: string, key: string): Promise<OAuthTokens> {
  return JSON.parse(await decryptSecret(tokensB64, key));
}

async function encryptOauthTokens(tokens: OAuthTokens, key: string): Promise<string> {
  return encryptSecret(JSON.stringify(tokens), key);
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

const SYNC_WINDOW_DAYS = 90;
const REMINDER_DEFAULT_MINUTES = 15;
const CALDAV_HOST = 'https://caldav.yandex.ru';

/**
 * Loads a connection by id and refuses it when it belongs to another profile.
 *
 * With one account per provider the (profile_id, provider) lookup was
 * unambiguous. Two accounts of the same provider make it ambiguous, and maybeSingle
 * would then either error or pick one arbitrarily -- so every action that touches
 * a specific connection addresses it by id and checks ownership here.
 */
async function loadOwnedConnection(
  supabase: ReturnType<typeof createClient>,
  connectionId: string,
  profileId: string,
): Promise<{ data: CalendarConnection | null; error: unknown }> {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select('id,profile_id,provider,provider_account_email,oauth_tokens_b64,caldav_password_b64,token_expires_at,is_active,last_sync_at')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  if ((data as { profile_id: string }).profile_id !== profileId) {
    return { data: null, error: 'not_owner' };
  }
  return { data: data as CalendarConnection, error: null };
}


function formatDateForQuery(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function upsertCalendarEvent(supabase: ReturnType<typeof createClient>, payload: CalendarEventPayload): Promise<void> {
  await supabase.from('calendar_events').upsert({
    profile_id: payload.profile_id, provider: payload.provider, remote_event_id: payload.remote_event_id,
    title: payload.title.slice(0, 500), description: payload.description?.slice(0, 5000) ?? null,
    start_at: payload.start_at, end_at: payload.end_at,
    is_all_day: payload.is_all_day,
    reminder_minutes_before: payload.reminder_minutes_before, source_synced_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,provider,remote_event_id', ignoreDuplicates: false });
}

/**
 * Sync events from Yandex CalDAV using an app password.
 *
 * CalDAV auth is HTTP Basic (login + app password). Measured 2026-09-26: an
 * OAuth token is rejected with 401 + `www-authenticate: Basic realm="CalDAV"`
 * in every shape (bearer, token as password, both path formats, root
 * PROPFIND), so the token alone cannot read a calendar.
 */
async function syncYandex(
  supabase: ReturnType<typeof createClient>,
  connection: CalendarConnection,
  caldavPassword: string,
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    const login = connection.provider_account_email;
    console.log('calendar_sync: CalDAV sync for', login);

    const now = new Date();
    const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const authHeader = `Basic ${btoa(`${login}:${caldavPassword}`)}`;

    // Yandex CalDAV layout, established by probing the live server 2026-09-26:
    //  - the principal must be discovered (a bare login 404s; the server hands
    //    back /principals/users/<login>%40<domain>/);
    //  - calendar-query REPORT is NOT supported and answers
    //    <D:error><supported-report/></D:error>;
    //  - events live in per-calendar subcollections, e.g.
    //    /calendars/<login>/events-9527465/, not directly under the home set.
    // So: discover -> list subcollections -> GET each .ics child.
    // The two PROPFINDs need different props: the root advertises
    // current-user-principal, the principal collection advertises
    // calendar-home-set. Reusing one body silently returned an empty home set
    // and the sync stopped with caldav_calendar_home_not_found.
    const rootPropfind = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`;
    const principalPropfind = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`;

    // Yandex uses two different spellings in the same response:
    //   <current-user-principal><D:href>...</D:href>   (inside D: props)
    //   <href xmlns="DAV:">...</href>                   (top-level responses)
    // One regex for both is what made the home set look missing.
    const hrefPattern = /<(?:D:)?href(?:\s[^>]*)?>([^<]+)<\/(?:D:)?href>/g;
    const innerHref = (xml: string, tag: string) => {
      const re = new RegExp(`<[^>]*${tag}[^>]*>\\s*<(?:D:)?href(?:\\s[^>]*)?>([^<]+)<\\/(?:D:)?href>`, 'i');
      return xml.match(re)?.[1]?.trim();
    };

    const rootRes = await fetch(`${CALDAV_HOST}/`, {
      method: 'PROPFIND',
      headers: { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8', Depth: '0' },
      body: rootPropfind,
    });

    if (!rootRes.ok) {
      if (rootRes.status === 401) return { synced: 0, errors: ['caldav_auth_failed_401'] };
      return { synced: 0, errors: [`caldav_discovery_failed_${rootRes.status}`] };
    }

    const rootXml = await rootRes.text();
    const principalHref = innerHref(rootXml, 'current-user-principal');
    if (!principalHref) return { synced: 0, errors: ['caldav_principal_not_found'] };

    const principalUrl = principalHref.startsWith('http') ? principalHref : `${CALDAV_HOST}${principalHref}`;

    const principalRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8', Depth: '0' },
      body: principalPropfind,
    });
    if (!principalRes.ok) {
      if (principalRes.status === 401) return { synced: 0, errors: ['caldav_auth_failed_401'] };
      return { synced: 0, errors: [`caldav_principal_failed_${principalRes.status}`] };
    }

    const principalXml = await principalRes.text();
    const homeHref = innerHref(principalXml, 'calendar-home-set');
    if (!homeHref) return { synced: 0, errors: ['caldav_calendar_home_not_found'] };

    const homeUrl = homeHref.startsWith('http') ? homeHref : `${CALDAV_HOST}${homeHref}`;

    const listRes = await fetch(homeUrl, {
      method: 'PROPFIND',
      headers: { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`,
    });
    if (!listRes.ok) {
      if (listRes.status === 401) return { synced: 0, errors: ['caldav_auth_failed_401'] };
      return { synced: 0, errors: [`caldav_list_failed_${listRes.status}`] };
    }

    const listXml = await listRes.text();
    const hrefs = [...listXml.matchAll(hrefPattern)].map((m) => m[1]);
    const homePath = new URL(homeUrl).pathname;

    // Per-calendar subcollections look like ".../events-123/" or ".../todos-1/".
    const calendarPaths = hrefs.filter((h) => {
      if (h === homePath) return false;
      if (/\/(inbox|outbox)\/?$/.test(h)) return false;
      return h.endsWith('/');
    });

    if (calendarPaths.length === 0) {
      console.log('calendar_sync: no calendar subcollections under', homeUrl);
      return { synced: 0, errors: [] };
    }

    console.log('calendar_sync: found', calendarPaths.length, 'calendar collections');

    // Collect every event href first, then fetch in bounded parallel batches.
    // Sequential GETs timed the function out (503) on a calendar with 18
    // events; the wall clock is dominated by round trips, not by bandwidth.
    const allEventUrls: string[] = [];

    for (const path of calendarPaths) {
      const calUrl = path.startsWith('http') ? path : `${CALDAV_HOST}${path}`;

      const childrenRes = await fetch(calUrl, {
        method: 'PROPFIND',
        headers: { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
        body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`,
      });
      if (!childrenRes.ok) {
        errors.push(`list_failed_${childrenRes.status}: ${path}`);
        continue;
      }

      const childrenXml = await childrenRes.text();
      for (const eventPath of [...childrenXml.matchAll(hrefPattern)]
        .map((m) => m[1])
        .filter((h) => !h.endsWith('/'))) {
        allEventUrls.push(eventPath.startsWith('http') ? eventPath : `${CALDAV_HOST}${eventPath}`);
      }
    }

    console.log('calendar_sync: fetching', allEventUrls.length, 'events');

    const BATCH = 8;
    let ics = '';
    for (let i = 0; i < allEventUrls.length; i += BATCH) {
      const batch = allEventUrls.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (url) => {
        try {
          const res = await fetch(url, { method: 'GET', headers: { Authorization: authHeader } });
          if (!res.ok) return null;
          return await res.text();
        } catch {
          return null;
        }
      }));
      for (const body of results) {
        if (body) ics += `${body}\n`;
      }
    }

    // GET-ing every .ics means no server-side time-range filter, so the window
    // is applied here instead of losing far-past and far-future events.
    const inWindow = (ev: ParsedEvent) => {
      const t = new Date(ev.startAt).getTime();
      return t >= since.getTime() && t <= until.getTime();
    };

    const all = parseVEvents(ics);
    const events = all.filter(inWindow);
    const skipped = all.length - events.length;
    console.log('calendar_sync: parsed', all.length, 'VEVENTs, in window', events.length, ', skipped', skipped);

    for (const ev of events) {
      try {
        await upsertCalendarEvent(supabase, {
          profile_id: connection.profile_id,
          provider: 'yandex',
          remote_event_id: ev.uid,
          title: ev.title,
          description: ev.description,
          start_at: ev.startAt,
          end_at: ev.endAt,
          is_all_day: ev.isAllDay,
          reminder_minutes_before: REMINDER_DEFAULT_MINUTES,
        });
        synced++;
      } catch (upsertErr) {
        errors.push(`upsert_error: ${upsertErr instanceof Error ? upsertErr.message : 'unknown'}`);
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
    
    // Server-side callers only: every /api/calendar/* route authenticates the
    // Telegram session first and then forwards the service-role key, so an exact
    // constant-time match is the whole check.
    //
    // The previous guard ALSO accepted any "Bearer " longer than 10 characters,
    // which left the endpoint effectively public -- the anon key shipped in the
    // client bundle satisfied it, so anyone could force a sync, overwrite a
    // stored CalDAV password, or deactivate another user's connection.
    //
    // Both env spellings are accepted because the value is configured under
    // one name or the other per environment, while the Next side always sends
    // SUPABASE_SERVICE_ROLE_KEY. With neither set we refuse rather than fall
    // open.
    const authHeader = req.headers.get('Authorization') || '';
    // All three names hold a service-role credential; the Next side always sends
    // SUPABASE_SERVICE_ROLE_KEY, and the project also provisions SB_SERVICE_ROLE_KEY.
    // Accepting the set removes any dependence on which single name is populated,
    // while still rejecting the anon key that shipped in the client bundle.
    const serviceKeys = [
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      Deno.env.get('SB_SERVICE_ROLE_KEY'),
      Deno.env.get('SUPABASE_SERVICE_KEY'),
    ].filter((k): k is string => Boolean(k));

    if (serviceKeys.length === 0) {
      console.error('calendar_sync: no service key configured, refusing request');
      return new Response(JSON.stringify({ error: 'server_misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const authorized = serviceKeys.some((k) => timingSafeEqual(authHeader, `Bearer ${k}`));
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const body = await req.json();
    const { profile_id, provider, action = 'sync' } = body as { profile_id?: string; provider?: 'yandex'; action?: 'sync' | 'connect' | 'disconnect' | 'set_password' };
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
        provider_account_email,
        caldav_password
      } = body as {
        code?: string;
        access_token?: string;
        refresh_token?: string;
        expires_at?: number;
        provider_account_email?: string;
        caldav_password?: string
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
      
      // Resolve the account FIRST, then look the row up by it.
      //
      // The lookup used to run before this and key on (profile, provider), which
      // was only unambiguous because one account per provider was enforced. A second
      // Yandex login makes that ambiguous, and a new account would overwrite the
      // existing one. The account login is the real key: re-authorising the same
      // address updates its row, a different address adds another.
      //
      // Never fall back to a placeholder login: a fake one silently produced an
      // invalid CalDAV URL and a confusing 401.
      let accountEmail = provider_account_email;
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

      const { data: existingConnection } = await supabase
        .from('calendar_connections')
        .select('id, provider_account_email')
        .eq('profile_id', profile_id)
        .eq('provider', provider)
        .eq('provider_account_email', accountEmail)
        .maybeSingle();
      
      const encryptedB64 = await encryptOauthTokens(tokens, encryptionKey);
      const now = new Date().toISOString();
      const expiresAt = new Date(tokens.expires_at * 1000).toISOString();

      // CalDAV app password (CAL-07). Optional here so the OAuth connection can
      // be established first; sync stays blocked until it is supplied.
      let encryptedPasswordB64: string | null = null;
      if (typeof caldav_password === 'string' && caldav_password.trim() !== '') {
        encryptedPasswordB64 = await encryptSecret(caldav_password.trim(), encryptionKey);
      }

      if (existingConnection) {
        const updatePayload: Record<string, unknown> = {
          oauth_tokens_b64: encryptedB64,
          provider_account_email: accountEmail,
          token_expires_at: expiresAt,
          is_active: true,
          last_sync_at: null,
        };
        // Preserve an existing password unless a new one is supplied.
        if (encryptedPasswordB64) updatePayload.caldav_password_b64 = encryptedPasswordB64;

        await supabase.from('calendar_connections').update(updatePayload).eq('id', existingConnection.id);
      } else {
        const { error: insertError } = await supabase.from('calendar_connections').insert({
          profile_id, provider, provider_account_email: accountEmail,
          oauth_tokens_b64: encryptedB64, token_expires_at: expiresAt,
          caldav_password_b64: encryptedPasswordB64,
          is_active: true, connected_at: now
        });
        if (insertError) {
          console.error('calendar_sync: connection insert error', insertError);
          return new Response(JSON.stringify({ error: 'connection_save_failed', details: insertError }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      // Initial sync only makes sense once a CalDAV password exists.
      let syncResult = { synced: 0, errors: ['caldav_password_required'] as string[] };
      let passwordForSync: string | null = encryptedPasswordB64;
      if (!passwordForSync && existingConnection) {
        const { data: existingRow } = await supabase
          .from('calendar_connections')
          .select('caldav_password_b64')
          .eq('id', existingConnection.id)
          .maybeSingle();
        if (existingRow?.caldav_password_b64) {
          passwordForSync = await decryptSecret(existingRow.caldav_password_b64, encryptionKey);
        }
      }

      if (passwordForSync) {
        try {
          syncResult = await syncYandex(supabase, {
            id: existingConnection?.id || '', profile_id, provider,
            provider_account_email: accountEmail, oauth_tokens_b64: encryptedB64,
            caldav_password_b64: encryptedPasswordB64,
            token_expires_at: expiresAt, is_active: true, last_sync_at: null
          } as CalendarConnection, passwordForSync);
        } catch (syncErr) {
          console.error('calendar_sync: initial sync failed', syncErr);
          syncResult = { synced: 0, errors: [syncErr instanceof Error ? syncErr.message : 'unknown'] };
        }
      }

      return new Response(JSON.stringify({
        message: 'Calendar connected successfully', provider,
        synced: syncResult.synced,
        errors: syncResult.errors.length > 0 ? syncResult.errors : undefined
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ═══ Disconnect action ═══
    if (action === 'disconnect') {
      const { connection_id: targetId } = body as { connection_id?: string };
      if (!targetId) {
        return new Response(JSON.stringify({ error: 'missing_connection_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const { data: target, error: loadErr } = await loadOwnedConnection(supabase, targetId, profile_id);
      if (loadErr === 'not_owner') {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      if (loadErr) {
        return new Response(JSON.stringify({ error: 'connection_fetch_failed', details: loadErr }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      if (!target) {
        return new Response(JSON.stringify({ error: 'no_connection' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      // Removing an integration removes what it imported. The user asked for
      // this explicitly and there is no undo, so the client confirms first and
      // the count comes back for that confirmation to name.
      const { error: eventsErr, count: removed } = await supabase
        .from('calendar_events')
        .delete({ count: 'exact' })
        .eq('profile_id', profile_id)
        .eq('provider', target.provider);

      if (eventsErr) {
        console.error('calendar_sync: event delete error', eventsErr);
        return new Response(JSON.stringify({ error: 'events_delete_failed', details: eventsErr }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      const { error: delErr } = await supabase
        .from('calendar_connections')
        .delete()
        .eq('id', target.id);

      if (delErr) {
        return new Response(JSON.stringify({ error: 'disconnect_failed', details: delErr }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      console.log('calendar_sync: disconnected', target.id, 'events removed =', removed ?? 0);
      return new Response(
        JSON.stringify({ message: 'Calendar disconnected', deleted_events: removed ?? 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ═══ Set CalDAV app password (CAL-07) ═══
    // Separate from connect so an already-authorized user can add the password
    // without redoing OAuth.
    if (action === 'set_password') {
      const { caldav_password: newPassword } = body as { caldav_password?: string };
      if (!newPassword || newPassword.trim() === '') {
        return new Response(JSON.stringify({ error: 'missing_caldav_password' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const { connection_id: targetId } = body as { connection_id?: string };
      if (!targetId) {
        return new Response(JSON.stringify({ error: 'missing_connection_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const { data: target, error: targetErr } = await loadOwnedConnection(supabase, targetId, profile_id);

      if (targetErr === 'not_owner') {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      if (targetErr || !target) {
        return new Response(JSON.stringify({ error: 'no_connection' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      const encryptedPassword = await encryptSecret(newPassword.trim(), encryptionKey);
      const { error: saveErr } = await supabase
        .from('calendar_connections')
        .update({ caldav_password_b64: encryptedPassword })
        .eq('id', target.id);

      if (saveErr) {
        console.error('calendar_sync: password save error', saveErr);
        return new Response(JSON.stringify({ error: 'password_save_failed', details: saveErr }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ message: 'CalDAV password saved' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ═══ Sync action ═══
    const { connection_id: syncTargetId } = body as { connection_id?: string };
    if (!syncTargetId) {
      return new Response(JSON.stringify({ error: 'missing_connection_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: connection, error: connError } = await loadOwnedConnection(supabase, syncTargetId, profile_id) as { data: CalendarConnection | null; error: unknown };
    if (connError === 'not_owner') {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    if (connError) {
      console.error('calendar_sync: connection fetch error', connError);
      return new Response(JSON.stringify({ error: 'connection_fetch_failed', details: connError }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (!connection || !connection.is_active) {
      return new Response(JSON.stringify({ error: 'no_active_connection', hint: 'Connect calendar first via OAuth flow' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // Auto-refresh the OAuth token. The token no longer grants CalDAV access
    // (CAL-07), but keeping it valid means the user never re-authorizes and the
    // account login stays resolvable.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tokenExpirySeconds = connection.token_expires_at ? Math.floor(new Date(connection.token_expires_at).getTime() / 1000) : 0;
    const needsRefresh = tokenExpirySeconds > 0 && (nowSeconds + 300) > tokenExpirySeconds;

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
        console.log('calendar_sync: token refreshed successfully');
      } catch (refreshErr) {
        console.error('calendar_sync: token refresh failed', refreshErr);
        return new Response(JSON.stringify({ error: 'token_refresh_failed', hint: 'Re-authenticate calendar account' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // CAL-07: CalDAV requires an app password; the OAuth token alone cannot read
    // a calendar (verified 2026-09-26). Report it as a distinct, actionable
    // state rather than an empty calendar.
    if (!connection.caldav_password_b64) {
      return new Response(JSON.stringify({
        error: 'caldav_password_required',
        hint: 'Add a Yandex app password (Yandex ID -> App passwords -> Calendar) to enable syncing.',
      }), { status: 428, headers: { 'Content-Type': 'application/json' } });
    }

    let caldavPassword: string;
    try {
      caldavPassword = await decryptSecret(connection.caldav_password_b64, encryptionKey);
    } catch (pwErr) {
      console.error('calendar_sync: caldav password decryption failed', pwErr);
      return new Response(JSON.stringify({
        error: 'caldav_password_undecryptable',
        hint: 'Re-enter the Yandex app password.',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await syncYandex(supabase, connection, caldavPassword);

    // last_sync_at marks a fetch that actually reached CalDAV. A 401 leaves it
    // untouched so the UI keeps showing the last genuinely good sync instead of
    // a fresh timestamp over an empty calendar.
    if (result.errors.length === 0) {
      await supabase.from('calendar_connections')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', connection.id);
    }

    const response: Record<string, unknown> = {
      // Do not claim success when CalDAV rejected the request — an empty
      // calendar caused by a bad password must read as a failure.
      message: result.errors.length > 0 ? 'Calendar sync failed' : 'Calendar synced successfully',
      provider,
      synced: result.synced
    };
    if (result.errors.length > 0) {
      response.errors = result.errors;
      response.error = result.errors[0];
      if (result.errors[0] === 'caldav_auth_failed_401') {
        response.hint = 'Yandex rejected the app password. Check it in Yandex ID -> App passwords.';
      }
    }
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('calendar_sync: unexpected error', err);
    return new Response(JSON.stringify({ error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
