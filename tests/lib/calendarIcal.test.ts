/**
 * Regression cover for the Yandex CalDAV iCal parsing.
 *
 * The TZID bug these guard against was live in production: DTSTART's property
 * parameters were discarded, so `DTSTART;TZID=Europe/Moscow:20260814T100000`
 * became a floating time read in the runtime's local zone (UTC on Edge
 * Functions), and a 10:00 Moscow meeting was displayed three hours late.
 *
 * A first attempt at these tests asserted hardcoded instants for Europe/Moscow
 * and passed even with the TZID handling removed, because the suite ran on a
 * machine whose local zone already was Europe/Moscow — the broken fallback
 * produced the very same instant as the correct conversion. So the zone cases
 * below are written to be independent of the runner's own timezone: the
 * expectation is derived from the zone offset itself, and each case also
 * asserts that supplying a zone CHANGES the result, which is exactly what the
 * bug stopped doing.
 */

import { describe, it, expect } from 'vitest';
import {
  parseIcalDate,
  zonedWallTimeToUtc,
  timeZoneOffsetMs,
  unfoldIcalText,
  parseVEvents,
} from '../../supabase/functions/calendar-sync/ical';

/** The instant a wall-clock reading in `zone` corresponds to, any runner TZ. */
function wallToUtc(
  parts: [number, number, number, number, number, number],
  zone: string,
): string {
  const naive = Date.UTC(...parts);
  return new Date(naive - timeZoneOffsetMs(new Date(naive), zone)).toISOString();
}

const ZONES = [
  'Europe/Moscow',
  'Europe/Berlin',
  'Asia/Tokyo',
  'America/New_York',
  'Asia/Yekaterinburg',
  'Australia/Eucla',
] as const;

describe('parseIcalDate with TZID', () => {
  it.each(ZONES)('applies the %s offset to a wall-clock time', (zone) => {
    expect(parseIcalDate('20260814T100000', zone)).toBe(
      wallToUtc([2026, 7, 14, 10, 0, 0], zone),
    );
  });

  it.each(ZONES)('supplying %s changes the result', (zone) => {
    // The bug made the zone argument a no-op, so this is the assertion that
    // actually fails when TZID handling is removed.
    const withZone = parseIcalDate('20260814T100000', zone);
    const withoutZone = parseIcalDate('20260814T100000');
    const expected = wallToUtc([2026, 7, 14, 10, 0, 0], zone);

    expect(withZone).toBe(expected);
    if (expected !== withoutZone) {
      expect(withZone).not.toBe(withoutZone);
    }
  });

  it('ignores the zone for a Z-suffixed instant', () => {
    expect(parseIcalDate('20260814T230000Z', 'Europe/Moscow')).toBe('2026-08-14T23:00:00.000Z');
    expect(parseIcalDate('20260814T230000Z')).toBe('2026-08-14T23:00:00.000Z');
  });

  it('handles a time that lands on the previous UTC day', () => {
    // 00:00 in Tokyo on the 15th is still the 14th in UTC.
    expect(parseIcalDate('20260815T000000', 'Asia/Tokyo')).toBe('2026-08-14T15:00:00.000Z');
  });

  it('respects DST inside a zone that observes it', () => {
    const summer = parseIcalDate('20260714T100000', 'Europe/Berlin');
    const winter = parseIcalDate('20260114T100000', 'Europe/Berlin');
    expect(summer).toBe(wallToUtc([2026, 6, 14, 10, 0, 0], 'Europe/Berlin'));
    expect(winter).toBe(wallToUtc([2026, 0, 14, 10, 0, 0], 'Europe/Berlin'));
    expect(summer).not.toBe(winter);
  });

  it('stores a VALUE=DATE as UTC midnight', () => {
    expect(parseIcalDate('20260820')).toBe('2026-08-20T00:00:00.000Z');
  });

  it('falls back without throwing on an unknown zone', () => {
    const expected = new Date(2026, 7, 14, 10, 0, 0).toISOString();
    expect(parseIcalDate('20260814T100000', 'Not/AZone')).toBe(expected);
  });

  it('falls back to the runtime local reading when no zone is given', () => {
    const expected = new Date(2026, 7, 14, 10, 0, 0).toISOString();
    expect(parseIcalDate('20260814T100000')).toBe(expected);
  });
});

describe('zonedWallTimeToUtc', () => {
  it.each(ZONES)('agrees with the offset helper in %s', (zone) => {
    const got = zonedWallTimeToUtc(2026, 7, 14, 10, 0, 0, zone);
    expect(got.toISOString()).toBe(wallToUtc([2026, 7, 14, 10, 0, 0], zone));
  });

  it('shifts the offset by an hour across the Berlin spring-forward', () => {
    // Berlin moves to CEST on 2026-03-29, so the same wall-clock hour sits one
    // hour earlier in UTC on either side. Absolute instants, so these
    // expectations do not depend on the runner timezone.
    const before = zonedWallTimeToUtc(2026, 2, 28, 12, 0, 0, 'Europe/Berlin');
    const after = zonedWallTimeToUtc(2026, 2, 29, 12, 0, 0, 'Europe/Berlin');

    expect(before.toISOString()).toBe('2026-03-28T11:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-29T10:00:00.000Z');
    // One wall-clock day apart, but only 23 hours of real time: the missing
    // hour is the spring-forward itself.
    expect((after.getTime() - before.getTime()) / 3_600_000).toBe(23);
  });
});

describe('unfoldIcalText', () => {
  it('unescapes the RFC 5547 TEXT sequences Yandex emits', () => {
    expect(unfoldIcalText('a\\nb')).toBe('a\nb');
    expect(unfoldIcalText('a\\,b')).toBe('a,b');
    expect(unfoldIcalText('a\\;b')).toBe('a;b');
    expect(unfoldIcalText('a\\\\b')).toBe('a\\b');
  });

  it('trims surrounding whitespace', () => {
    expect(unfoldIcalText('  padded  ')).toBe('padded');
  });
});

function ics(...events: string[]): string {
  return ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
}

function vevent(...lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

describe('parseVEvents', () => {
  // Tokyo is used here because it is far from any likely runner zone, so the
  // expectation stays distinguishable from the local-time fallback.
  const TO = 'Asia/Tokyo';
  const tenAmTokyo = () => wallToUtc([2026, 7, 14, 10, 0, 0], TO);

  it('applies TZID to start and end', () => {
    const [ev] = parseVEvents(
      ics(
        vevent(
          'UID:ev1@yandex.ru',
          `DTSTART;TZID=${TO}:20260814T100000`,
          `DTEND;TZID=${TO}:20260814T103000`,
          'SUMMARY:call',
        ),
      ),
    );

    expect(ev.startAt).toBe(tenAmTokyo());
    expect(ev.endAt).toBe(wallToUtc([2026, 7, 14, 10, 30, 0], TO));
  });

  it('lets DTEND inherit the DTSTART zone when it carries none', () => {
    const [ev] = parseVEvents(
      ics(
        vevent(
          'UID:ev2@yandex.ru',
          `DTSTART;TZID=${TO}:20260814T100000`,
          'DTEND:20260814T113000',
          'SUMMARY:call',
        ),
      ),
    );

    expect(ev.endAt).toBe(wallToUtc([2026, 7, 14, 11, 30, 0], TO));
  });

  it('unfolds RFC 5545 continuation lines', () => {
    const [ev] = parseVEvents(
      ics(
        vevent(
          'UID:ev3@yandex.ru',
          `DTSTART;TZID=${TO}:20260814T100000`,
          'SUMMARY:a very long ti',
          ' tle that wraps',
        ),
      ),
    );

    expect(ev.title).toBe('a very long title that wraps');
  });

  it('clamps an inverted range to a zero-length event', () => {
    const [ev] = parseVEvents(
      ics(
        vevent(
          'UID:ev4@yandex.ru',
          `DTSTART;TZID=${TO}:20260814T100000`,
          `DTEND;TZID=${TO}:20260814T090000`,
          'SUMMARY:backwards',
        ),
      ),
    );

    expect(ev.endAt).toBe(ev.startAt);
  });

  it('defaults the end to the start when DTEND is absent', () => {
    const [ev] = parseVEvents(
      ics(vevent('UID:ev5@yandex.ru', `DTSTART;TZID=${TO}:20260814T100000`)),
    );

    expect(ev.endAt).toBe(ev.startAt);
  });

  it('skips blocks with no UID or no DTSTART', () => {
    const events = parseVEvents(
      ics(
        vevent(`DTSTART;TZID=${TO}:20260814T100000`, 'SUMMARY:no uid'),
        vevent('UID:no-start@yandex.ru', 'SUMMARY:no start'),
        vevent('UID:good@yandex.ru', `DTSTART;TZID=${TO}:20260814T100000`),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('good@yandex.ru');
  });

  it('falls back to a placeholder title and a null description', () => {
    const [ev] = parseVEvents(
      ics(vevent('UID:ev6@yandex.ru', `DTSTART;TZID=${TO}:20260814T100000`)),
    );

    expect(ev.title).toBe('Без названия');
    expect(ev.description).toBeNull();
  });

  it('parses several events from one payload', () => {
    const events = parseVEvents(
      ics(
        vevent('UID:a@yandex.ru', `DTSTART;TZID=${TO}:20260814T100000`, 'SUMMARY:a'),
        vevent('UID:b@yandex.ru', `DTSTART;TZID=${TO}:20260814T133000`, 'SUMMARY:b'),
      ),
    );

    expect(events.map((e) => e.uid)).toEqual(['a@yandex.ru', 'b@yandex.ru']);
    expect(events[1].startAt).toBe(wallToUtc([2026, 7, 14, 13, 30, 0], TO));
  });
});
