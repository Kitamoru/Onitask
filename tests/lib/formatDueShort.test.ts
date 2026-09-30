import { describe, it, expect } from 'vitest';
import { formatDueShort } from '../../src/lib/date';

/**
 * Формат срока в карточках: «до Чт 12 ноя.».
 *
 * Хелпер вынесен из StreamView, потому что список подзадач должен показывать
 * срок ровно так же. Значит, «как в карточке задачи» — это не «скопировать
 * массивы ещё раз», а общий источник. Тест фиксирует и формат, и то, что
 * битая дата не превращается в «до undefined NaN NaN.».
 */
describe('formatDueShort', () => {
  it('короткий формат: день недели, число, месяц с точкой', () => {
    // 2026-11-12 — четверг.
    expect(formatDueShort('2026-11-12T12:00:00Z')).toBe('до Чт 12 ноя.');
  });

  it('принимает и Date, и ISO-строку', () => {
    expect(formatDueShort(new Date('2026-11-12T12:00:00Z'))).toBe('до Чт 12 ноя.');
  });

  it('пустой срок -> null, а не «до undefined»', () => {
    expect(formatDueShort(null)).toBeNull();
    expect(formatDueShort(undefined)).toBeNull();
    expect(formatDueShort('')).toBeNull();
  });

  it('битая дата -> null', () => {
    // Без проверки строка выглядела бы как «до Invalid Date NaN NaN.» —
    // и тихо показывалась бы в углу карточки.
    expect(formatDueShort('не дата')).toBeNull();
  });

  it('первый и последний день месяца не съезжают', () => {
    expect(formatDueShort('2026-01-01T12:00:00Z')).toMatch(/^до [А-Яа-я]{2} 1 янв\.$/);
    expect(formatDueShort('2026-12-31T12:00:00Z')).toMatch(/^до [А-Яа-я]{2} 31 дек\.$/);
  });

  it('счётчик месяцев не сбит на 12-м', () => {
    // months[11] должен быть «дек.», а не undefined — опечатка в массиве
    // проявилась бы только в декабре.
    for (const [iso, month] of [
      ['2026-01-15T12:00:00Z', 'янв.'],
      ['2026-06-15T12:00:00Z', 'июн.'],
      ['2026-12-15T12:00:00Z', 'дек.'],
    ] as const) {
      expect(formatDueShort(iso)).toContain(month);
    }
  });
});
