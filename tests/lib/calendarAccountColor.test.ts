/**
 * Regression cover for the per-account colour slot.
 *
 * The bug this guards is the one the user reported: with two Yandex accounts
 * both pills rendered amber, because the colour came from the provider and
 * every account shared one. Distinctness is a property worth pinning -- it is
 * the entire reason the slot exists.
 */

import { describe, it, expect } from 'vitest';
import { calendarAccountColor } from '@/lib/calendar';

describe('calendarAccountColor', () => {
  it('gives each of the first five accounts a different token', () => {
    const slots = [0, 1, 2, 3, 4].map(calendarAccountColor);
    expect(slots).toEqual([
      'var(--color-calendar-1)',
      'var(--color-calendar-2)',
      'var(--color-calendar-3)',
      'var(--color-calendar-4)',
      'var(--color-calendar-5)',
    ]);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('never repeats a colour across the first five accounts', () => {
    const colours = [0, 1, 2, 3, 4].map(calendarAccountColor);
    expect(new Set(colours).size).toBe(5);
  });

  it('does not wrap past the palette', () => {
    // Wrapping would hand the 6th account the 1st account's colour, which is
    // the failure being prevented. Overflow goes neutral instead.
    expect(calendarAccountColor(5)).toBe('var(--color-calendar-6)');
    expect(calendarAccountColor(99)).toBe('var(--color-calendar-6)');
    expect(calendarAccountColor(5)).not.toBe(calendarAccountColor(0));
  });

  it('falls back to the first slot for missing or nonsense input', () => {
    expect(calendarAccountColor(null)).toBe(calendarAccountColor(0));
    expect(calendarAccountColor(undefined)).toBe(calendarAccountColor(0));
    expect(calendarAccountColor(-1)).toBe(calendarAccountColor(0));
    expect(calendarAccountColor(1.5)).toBe(calendarAccountColor(0));
  });
});
