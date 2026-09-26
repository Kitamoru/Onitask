/**
 * OAuth `state` for the Yandex calendar connect flow.
 *
 * The state used to be the bare `profile_id`. That is a request parameter on a
 * publicly reachable GET endpoint, so an attacker could take their own Yandex
 * authorization code, call
 *   /api/calendar/callback/yandex?code=<attacker's code>&state=<victim uuid>
 * and have the token exchange write the attacker's calendar into the victim's
 * `calendar_connections` row, silently replacing their real integration.
 *
 * OAuth requires `state` to be an unguessable value that binds the callback to
 * the request that started it. Here that is a short-lived HMAC over the profile
 * id: self-contained, so no table or nonce store is needed, and it expires so a
 * captured URL cannot be replayed.
 *
 * The signing key is the bot token with a domain-separating label, so the HMAC
 * is never interchangeable with any other use of that secret.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;
const LABEL = 'onitask:calendar-oauth-state:v1';

function secret(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

function mac(payload: string): string {
  return createHmac('sha256', secret()).update(`${LABEL}:${payload}`).digest('base64url');
}

/**
 * Builds `state` as `<profileId>.<expiryMs>.<mac>`. The expiry is inside the
 * signed payload, so it cannot be extended by whoever holds the value.
 */
export function signCalendarState(profileId: string, now: number = Date.now()): string {
  const expiry = String(now + STATE_TTL_MS);
  return `${profileId}.${expiry}.${mac(`${profileId}.${expiry}`)}`;
}

export type VerifyResult =
  | { ok: true; profileId: string }
  | { ok: false; error: 'malformed_state' | 'bad_signature' | 'expired_state' };

/**
 * Verifies and decodes a `state`. Returns the profile id only when the signature
 * matches and the token is still fresh.
 */
export function verifyCalendarState(state: string, now: number = Date.now()): VerifyResult {
  const parts = state.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed_state' };

  const [profileId, expiryRaw, providedMac] = parts;
  if (!profileId || !expiryRaw || !providedMac) return { ok: false, error: 'malformed_state' };

  const expected = mac(`${profileId}.${expiryRaw}`);

  const a = Buffer.from(providedMac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'bad_signature' };
  }

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || now > expiry) {
    return { ok: false, error: 'expired_state' };
  }

  return { ok: true, profileId };
}
