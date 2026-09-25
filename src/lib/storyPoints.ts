export const LEGACY_STORY_POINT_VALUES = [1, 3, 5, 7, 13] as const;

export const DEFAULT_STORY_POINT_VALUES = [1, 2, 3, 5, 8] as const;
export const COGNITIVE_WEIGHT_VALUES = [0, 1, 2, 3] as const;

export type StoryPointValue = (typeof DEFAULT_STORY_POINT_VALUES)[number];
export type StoryPointHours = Record<string, string>;

export interface StoryPointsConfigInput {
  enabled?: unknown;
  sprint_enabled?: unknown;
  values?: unknown;
  hours_per_sp?: unknown;
}

export interface NormalizedStoryPointsConfig {
  enabled: boolean;
  sprintEnabled: boolean;
  values: number[];
  hoursPerSp: StoryPointHours;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize workspace JSON without inventing duration/cost fallbacks. */
export function normalizeStoryPointsConfig(input: unknown): NormalizedStoryPointsConfig {
  const config = isRecord(input) ? input : {};
  const rawValues = Array.isArray(config.values) ? config.values : [];
  const values = rawValues
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a - b);

  const rawHours = isRecord(config.hours_per_sp) ? config.hours_per_sp : {};
  const hoursPerSp: StoryPointHours = {};
  for (const [key, value] of Object.entries(rawHours)) {
    const numericKey = Number(key);
    if (Number.isInteger(numericKey) && numericKey > 0 && typeof value === 'string' && value.trim()) {
      hoursPerSp[String(numericKey)] = value.trim();
    }
  }

  const normalizedValues = values.length > 0 ? values : [...DEFAULT_STORY_POINT_VALUES];
  const isLegacyDefault = normalizedValues.length === LEGACY_STORY_POINT_VALUES.length
    && normalizedValues.every((value, index) => value === LEGACY_STORY_POINT_VALUES[index]);

  return {
    enabled: config.enabled === true,
    sprintEnabled: config.sprint_enabled === true,
    values: isLegacyDefault ? [...DEFAULT_STORY_POINT_VALUES] : normalizedValues,
    hoursPerSp,
  };
}

export function isAllowedStoryPoint(value: unknown, allowedValues: readonly number[] = DEFAULT_STORY_POINT_VALUES): value is number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && allowedValues.includes(numeric);
}

export function isValidCognitiveWeight(value: unknown): value is number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && (COGNITIVE_WEIGHT_VALUES as readonly number[]).includes(numeric);
}

/** Returns an explicit team cost only when one was configured. */
export function storyPointCostLabel(value: number, hoursPerSp: StoryPointHours): string | null {
  const cost = hoursPerSp[String(value)]?.trim();
  return cost ? `${value} SP · ${cost}` : `${value} SP`;
}
