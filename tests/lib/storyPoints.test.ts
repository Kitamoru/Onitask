import { describe, expect, it } from 'vitest';
import {
  COGNITIVE_WEIGHT_VALUES,
  DEFAULT_STORY_POINT_VALUES,
  isAllowedStoryPoint,
  isValidCognitiveWeight,
  normalizeStoryPointsConfig,
  storyPointCostLabel,
} from '@/lib/storyPoints';

describe('story point settings', () => {
  it('uses Fibonacci defaults and preserves only explicit costs', () => {
    const config = normalizeStoryPointsConfig({
      enabled: true,
      hours_per_sp: { '1': '2 часа', '2': '', x: 'bad' },
    });

    expect(DEFAULT_STORY_POINT_VALUES).toEqual([1, 2, 3, 5, 8]);
    expect(config.values).toEqual([1, 2, 3, 5, 8]);
    expect(config.hoursPerSp).toEqual({ '1': '2 часа' });
    expect(storyPointCostLabel(1, config.hoursPerSp)).toBe('1 SP · 2 часа');
    expect(storyPointCostLabel(5, config.hoursPerSp)).toBe('5 SP');
  });

  it('validates team scales and cognitive weights', () => {
    expect(isAllowedStoryPoint(5, [1, 2, 3, 5, 8])).toBe(true);
    expect(isAllowedStoryPoint(7, [1, 2, 3, 5, 8])).toBe(false);
    expect(isValidCognitiveWeight(3)).toBe(true);
    expect(isValidCognitiveWeight(4)).toBe(false);
    expect(COGNITIVE_WEIGHT_VALUES).toEqual([0, 1, 2, 3]);
  });

  it('migrates the legacy default scale to Fibonacci values', () => {
    expect(normalizeStoryPointsConfig({ values: [1, 3, 5, 7, 13] }).values)
      .toEqual([1, 2, 3, 5, 8]);
  });

});
