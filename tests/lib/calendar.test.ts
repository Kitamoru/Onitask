/**
 * Regression cover for the local-vs-UTC day boundary.
 *
 * `groupEventsByDate` used to key days with `toISOString().split('T')[0]`,
 * which is the UTC date. Every user of this app is east of Greenwich, so an
 * event at 00:30 Moscow landed on the previous day. Under a time axis that is
 * immediately visible as an event sitting on the wrong day, so this pins the
 * behaviour rather than trusting it.
 *
 * TZ is pinned at module load: on a UTC runner the bug is invisible, so
 * without this the test would pass without ever exercising the failure.
 */
process.env.TZ = 'Europe/Moscow';

import { describe, it, expect } from 'vitest';
import { localDateKey, isSameLocalDay, groupEventsByDate } from '@/lib/calendar';
import type { CalendarEvent } from '@/types/calendar';

function makeEvent(startAt: string, id = startAt): CalendarEvent {
  return {
    id,
    profile_id: 'p',
    provider: 'yandex',
    remote_event_id: id,
    title: 'test',
    description: null,
    start_at: startAt,
    end_at: startAt,
    reminder_minutes_before: null,
    created_by: null,
    updated_by: null,
    source_synced_at: null,
    created_at: startAt,
    updated_at: startAt,
  };
}

describe('localDateKey', () => {
  it('uses the local day, not the UTC day', () => {
    // 23:30Z is already the 15th in Moscow.
    const at = '2026-08-14T23:30:00.000Z';
    expect(localDateKey(at)).toBe('2026-08-15');
    expect(localDateKey(at)).not.toBe(at.split('T')[0]);
  });

  it('keeps an event just past UTC midnight on the same local day', () => {
    // 00:30Z is still the 14th in Moscow — the case the UTC key got wrong.
    const at = '2026-08-14T00:30:00.000Z';
    expect(localDateKey(at)).toBe('2026-08-14');
  });

  it('accepts a Date and zero-pads month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('does not shift a wall-clock date built from local components', () => {
    expect(localDateKey(new Date(2026, 7, 14, 9, 0))).toBe('2026-08-14');
  });
});

describe('isSameLocalDay', () => {
  it('separates two instants that share a UTC day but not a local day', () => {
    expect(isSameLocalDay(new Date('2026-08-14T20:00:00Z'), new Date('2026-08-14T23:30:00Z'))).toBe(false);
  });

  it('matches two instants inside one local day', () => {
    expect(isSameLocalDay(new Date('2026-08-14T10:00:00Z'), new Date('2026-08-14T20:00:00Z'))).toBe(true);
  });
});

describe('groupEventsByDate', () => {
  it('files a late-evening event under the local day', () => {
    const events = [
      makeEvent('2026-08-14T10:00:00.000Z', 'a'),
      makeEvent('2026-08-14T23:30:00.000Z', 'b'),
    ];
    const grouped = groupEventsByDate(events);

    expect([...grouped.keys()].sort()).toEqual(['2026-08-14', '2026-08-15']);
    expect(grouped.get('2026-08-15')?.map((e) => e.id)).toEqual(['b']);
    expect(grouped.get('2026-08-14')?.map((e) => e.id)).toEqual(['a']);
  });
});
