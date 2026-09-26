/**
 * Regression cover for the OAuth `state` used by the calendar connect flow.
 *
 * The state used to be the bare profile_id, which made
 * /api/calendar/callback/yandex forgeable: an attacker could pass their own
 * Yandex code plus a victim's uuid and have the token exchange write the
 * attacker's calendar into the victim's connection row. These cases pin the
 * three properties that close it — it is signed, it is bound to the profile it
 * names, and it expires.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { signCalendarState, verifyCalendarState } from '../../lib/calendar-oauth-state';

const PROFILE = '9770a9dc-3357-41a6-844c-4a76a93c06cd';
const OTHER = '00000000-1111-2222-3333-444444444444';
const T0 = 1_700_000_000_000;

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-for-oauth-state';
});

describe('signCalendarState / verifyCalendarState', () => {
  it('round-trips the profile id', () => {
    const state = signCalendarState(PROFILE, T0);
    expect(verifyCalendarState(state, T0 + 1000)).toEqual({ ok: true, profileId: PROFILE });
  });

  it('never puts the bare profile id in the state', () => {
    // The old format was exactly the profile id, which is why it was guessable.
    expect(signCalendarState(PROFILE, T0)).not.toBe(PROFILE);
  });

  it('rejects a swapped profile id', () => {
    const state = signCalendarState(PROFILE, T0);
    const [profile, expiry, mac] = state.split('.');
    const forged = `${OTHER}.${expiry}.${mac}`;
    expect(verifyCalendarState(forged, T0 + 1000)).toEqual({
      ok: false,
      error: 'bad_signature',
    });
  });

  it('rejects an extended expiry', () => {
    const state = signCalendarState(PROFILE, T0);
    const [profile, , mac] = state.split('.');
    const stretched = `${profile}.${T0 + 86_400_000}.${mac}`;
    expect(verifyCalendarState(stretched, T0 + 1000)).toEqual({
      ok: false,
      error: 'bad_signature',
    });
  });

  it('rejects a malformed state', () => {
    expect(verifyCalendarState(PROFILE, T0).ok).toBe(false);
    expect(verifyCalendarState('a.b', T0).ok).toBe(false);
    expect(verifyCalendarState('', T0).ok).toBe(false);
  });

  it('rejects an expired state', () => {
    const state = signCalendarState(PROFILE, T0);
    // TTL is 10 minutes; check well past it.
    expect(verifyCalendarState(state, T0 + 11 * 60 * 1000)).toEqual({
      ok: false,
      error: 'expired_state',
    });
  });

  it('is deterministic for the same profile and instant', () => {
    expect(signCalendarState(PROFILE, T0)).toBe(signCalendarState(PROFILE, T0));
  });

  it('gives different states for different profiles at the same instant', () => {
    expect(signCalendarState(PROFILE, T0)).not.toBe(signCalendarState(OTHER, T0));
  });
});
