/**
 * Regression cover for the day-axis geometry.
 *
 * The lane algorithm decides whether overlapping events are readable or
 * stacked on top of each other, and the minute arithmetic decides where a block
 * is drawn. A mistake here renders a plausible-looking but wrong axis, which
 * review will not catch — the first version of this file was verified only by
 * looking at it.
 *
 * All inputs are built from local date parts, so `minutesOfDay` (which uses
 * local getters) is consistent on any runner timezone.
 */

import { describe, it, expect } from 'vitest';
import { layoutDayEvents, minutesOfDay, type Positioned } from '@/lib/calendar';
import type { CalendarEvent } from '@/types/calendar';

let seq = 0;

function at(hour: number, minute = 0): string {
  return new Date(2026, 7, 14, hour, minute, 0, 0).toISOString();
}

function ev(startHour: number, startMin: number, endHour: number, endMin: number): CalendarEvent {
  const id = `e${seq++}`;
  return {
    id,
    profile_id: 'p',
    provider: 'yandex',
    remote_event_id: id,
    title: id,
    description: null,
    start_at: at(startHour, startMin),
    end_at: at(endHour, endMin),
    reminder_minutes_before: null,
    created_by: null,
    updated_by: null,
    source_synced_at: null,
    created_at: at(startHour, startMin),
    updated_at: at(startHour, startMin),
  };
}

const laneOf = (result: Positioned[], id: string) =>
  result.find((p) => p.event.id === id)!;

describe('minutesOfDay', () => {
  it('returns local minutes since midnight', () => {
    expect(minutesOfDay(at(0, 0))).toBe(0);
    expect(minutesOfDay(at(9, 0))).toBe(540);
    expect(minutesOfDay(at(13, 30))).toBe(810);
    expect(minutesOfDay(at(23, 59))).toBe(1439);
  });
});

describe('layoutDayEvents', () => {
  it('returns nothing for an empty day', () => {
    expect(layoutDayEvents([])).toEqual([]);
  });

  it('places a single event in one lane at its real position', () => {
    const [p] = layoutDayEvents([ev(9, 0, 10, 30)]);

    expect(p.startMinutes).toBe(540);
    expect(p.endMinutes).toBe(630);
    expect(p.lane).toBe(0);
    expect(p.lanes).toBe(1);
  });

  it('keeps non-overlapping events in separate clusters', () => {
    const result = layoutDayEvents([ev(9, 0, 10, 0), ev(14, 0, 15, 0)]);

    expect(result).toHaveLength(2);
    expect(result.every((p) => p.lanes === 1)).toBe(true);
  });

  it('treats events that merely touch as non-overlapping', () => {
    // 10:00 end and 10:00 start share an instant but do not overlap.
    const result = layoutDayEvents([ev(9, 0, 10, 0), ev(10, 0, 11, 0)]);

    expect(result.every((p) => p.lanes === 1)).toBe(true);
  });

  it('splits two overlapping events into two lanes', () => {
    const result = layoutDayEvents([ev(9, 0, 10, 0), ev(9, 30, 10, 30)]);

    expect(result.every((p) => p.lanes === 2)).toBe(true);
    expect(laneOf(result, result[0].event.id).lane).toBe(0);
    expect(laneOf(result, result[1].event.id).lane).toBe(1);
  });

  it('splits three fully stacked events into three lanes', () => {
    const result = layoutDayEvents([ev(9, 0, 12, 0), ev(9, 0, 12, 0), ev(9, 0, 12, 0)]);

    expect(result).toHaveLength(3);
    expect(result.every((p) => p.lanes === 3)).toBe(true);
    expect(new Set(result.map((p) => p.lane))).toEqual(new Set([0, 1, 2]));
  });

  it('reuses a lane once the previous event in it has ended', () => {
    // A 09:00-10:00, B 09:30-11:00, C 10:30-12:00.
    // A and B overlap, B and C overlap, A and C do not, so all three share a
    // cluster of two lanes and C may sit under A.
    const a = ev(9, 0, 10, 0);
    const b = ev(9, 30, 11, 0);
    const c = ev(10, 30, 12, 0);
    const result = layoutDayEvents([a, b, c]);

    expect(result.every((p) => p.lanes === 2)).toBe(true);
    expect(laneOf(result, a.id).lane).toBe(0);
    expect(laneOf(result, b.id).lane).toBe(1);
    expect(laneOf(result, c.id).lane).toBe(0);
  });

  it('reuses a lane inside an open cluster when the slot just freed up', () => {
    // A spans the boundary, so the cluster is still open when C starts exactly
    // where B ends. C must take B's lane rather than open a third one.
    const a = ev(9, 0, 11, 0);
    const b = ev(9, 30, 10, 0);
    const c = ev(10, 0, 10, 30);
    const result = layoutDayEvents([a, b, c]);

    expect(laneOf(result, a.id).lane).toBe(0);
    expect(laneOf(result, b.id).lane).toBe(1);
    expect(laneOf(result, c.id).lane).toBe(1);
    expect(result.every((p) => p.lanes === 2)).toBe(true);
  });
  it('separates clusters that only overlap transitively at a distance', () => {
    // Two pairs far apart must not be forced into one cluster.
    const result = layoutDayEvents([
      ev(9, 0, 10, 0),
      ev(9, 30, 10, 30),
      ev(20, 0, 21, 0),
      ev(20, 30, 21, 30),
    ]);

    const morning = result.filter((p) => p.startMinutes < 720);
    const evening = result.filter((p) => p.startMinutes >= 720);
    expect(morning.every((p) => p.lanes === 2)).toBe(true);
    expect(evening.every((p) => p.lanes === 2)).toBe(true);
  });

  it('sorts by start regardless of input order', () => {
    const late = ev(18, 0, 19, 0);
    const early = ev(8, 0, 9, 0);
    const result = layoutDayEvents([late, early]);

    expect(result.map((p) => p.event.id)).toEqual([early.id, late.id]);
  });

  it('gives a zero-length event a visible block', () => {
    const [p] = layoutDayEvents([ev(12, 0, 12, 0)]);

    expect(p.endMinutes).toBe(p.startMinutes + 30);
  });

  it('gives an inverted range a visible block', () => {
    const [p] = layoutDayEvents([ev(12, 0, 11, 0)]);

    expect(p.endMinutes).toBe(p.startMinutes + 30);
  });
});
