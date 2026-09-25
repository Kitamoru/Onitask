import { describe, expect, it } from 'vitest';
import {
  COGNITIVE_WEIGHT_VALUES,
  DEFAULT_STORY_POINT_VALUES,
  defaultStoryPointHours,
  isAllowedStoryPoint,
  isValidCognitiveWeight,
  normalizeStoryPointsConfig,
  parseStoryPointTimeRange,
  storyPointTimeRangeError,
  storyPointCostLabel,
  validateStoryPointHours,
} from '@/lib/storyPoints';

describe('story point settings', () => {
  it('keeps only explicit ranges when reading settings', () => {
    const config = normalizeStoryPointsConfig({
      enabled: true,
      hours_per_sp: { '1': '2 часа', '2': '', x: 'bad' },
    });

    expect(DEFAULT_STORY_POINT_VALUES).toEqual([1, 2, 3, 5, 8]);
    expect(config.values).toEqual([1, 2, 3, 5, 8]);
    expect(config.hoursPerSp).toEqual({ '1': '2–2 часа' });
    expect(storyPointCostLabel(1, config.hoursPerSp)).toBe('1 SP · 2–2 часа');
    expect(storyPointCostLabel(5, config.hoursPerSp)).toBe('5 SP');
  });

  it('validates team scales and cognitive weights', () => {
    expect(isAllowedStoryPoint(5, [1, 2, 3, 5, 8])).toBe(true);
    expect(isAllowedStoryPoint(7, [1, 2, 3, 5, 8])).toBe(false);
    expect(isValidCognitiveWeight(3)).toBe(true);
    expect(isValidCognitiveWeight(4)).toBe(false);
    expect(COGNITIVE_WEIGHT_VALUES).toEqual([0, 1, 2, 3]);
  });

  it('validates and normalizes duration ranges', () => {
    expect(parseStoryPointTimeRange('2–4 часа')?.normalized).toBe('2–4 часа');
    expect(parseStoryPointTimeRange('2 часа')?.normalized).toBe('2–2 часа');
    expect(parseStoryPointTimeRange('0.5–1 час')?.normalized).toBe('0.5–1 час');
    expect(parseStoryPointTimeRange('10–2 часов')).toBeNull();
    expect(parseStoryPointTimeRange('-5 часов')).toBeNull();
    expect(parseStoryPointTimeRange('1000 часов')).toBeNull();
    expect(storyPointTimeRangeError('abc')).toContain('положительный диапазон');
    expect(validateStoryPointHours({ '3': '4–8 часов', '7': '2 часа' })).not.toBeNull();
  });

  it('migrates the legacy default scale to Fibonacci values', () => {
    expect(normalizeStoryPointsConfig({ values: [1, 3, 5, 7, 13] }).values)
      .toEqual([1, 2, 3, 5, 8]);
  });

  it('keeps only reference tasks for configured SP values', () => {
    const config = normalizeStoryPointsConfig({
      enabled: true,
      reference_tasks: {
        '3': { task_id: 'done-3', full_id: 'TASK-3', title: 'Reference' },
        '7': { task_id: 'done-7', full_id: 'TASK-7', title: 'Ignored' },
        'bad': { task_id: 'done-bad' },
      },
    });
    expect(config.referenceTasks).toEqual({
      '3': { task_id: 'done-3', full_id: 'TASK-3', title: 'Reference' },
    });
  });

  it('returns a fresh mutable default range map', () => {
    const first = defaultStoryPointHours();
    first['1'] = 'changed';
    expect(defaultStoryPointHours()['1']).toBe('1–2 часа');
  });

});
