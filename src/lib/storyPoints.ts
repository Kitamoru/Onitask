export const LEGACY_STORY_POINT_VALUES = [1, 3, 5, 7, 13] as const;

export const DEFAULT_STORY_POINT_VALUES = [1, 2, 3, 5, 8] as const;
export const COGNITIVE_WEIGHT_VALUES = [0, 1, 2, 3] as const;
export const DEFAULT_STORY_POINT_RANGES: Readonly<Record<string, string>> = {
  '1': '1–2 часа',
  '2': '2–4 часа',
  '3': '4–8 часов',
  '5': '8–16 часов',
  '8': '16–32 часа',
};

export type StoryPointReferenceTask = {
  task_id: string;
  full_id?: string | null;
  title?: string | null;
};
export type StoryPointReferenceTasks = Record<string, StoryPointReferenceTask>;

export type StoryPointValue = (typeof DEFAULT_STORY_POINT_VALUES)[number];
export type StoryPointHours = Record<string, string>;
export type StoryPointTimeRange = { min: number; max: number; normalized: string };

export const MAX_STORY_POINT_HOURS = 720;
const STORY_POINT_RANGE_PATTERN = /^\s*(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*(\d+(?:[.,]\d+)?))?\s*(?:ч(?:ас(?:а|ов)?)?\.?)\s*$/iu;

function hoursWord(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'час';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'часа';
  return 'часов';
}

function formatHours(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** Parse one exact or range duration. Legacy `2 часа` becomes `2–2 часа`. */
export function parseStoryPointTimeRange(value: unknown): StoryPointTimeRange | null {
  if (typeof value !== 'string') return null;
  const match = STORY_POINT_RANGE_PATTERN.exec(value.trim());
  if (!match) return null;
  const min = Number(match[1].replace(',', '.'));
  const max = match[2] === undefined ? min : Number(match[2].replace(',', '.'));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min <= 0 || max <= 0 || min > max || max > MAX_STORY_POINT_HOURS) return null;
  return {
    min,
    max,
    normalized: `${formatHours(min)}–${formatHours(max)} ${hoursWord(max)}`,
  };
}

export function storyPointTimeRangeError(value: unknown): string | null {
  if (parseStoryPointTimeRange(value)) return null;
  return 'Введите положительный диапазон до 720 часов: минимум не больше максимума. Например: 4–8 часов.';
}

export function validateStoryPointHours(
  hours: unknown,
  allowedValues: readonly number[] = DEFAULT_STORY_POINT_VALUES,
): { sp: number; value: unknown; message: string } | null {
  if (hours === undefined) return null;
  if (!isRecord(hours)) return { sp: 0, value: hours, message: 'Диапазоны времени указаны в неверном формате.' };
  for (const [key, value] of Object.entries(hours)) {
    const sp = Number(key);
    if (!Number.isInteger(sp) || !allowedValues.includes(sp)) {
      return { sp, value, message: `Диапазон для ${key} SP не соответствует шкале доски.` };
    }
    const message = storyPointTimeRangeError(value);
    if (message) return { sp, value, message };
  }
  return null;
}

export interface StoryPointsConfigInput {
  enabled?: unknown;
  sprint_enabled?: unknown;
  values?: unknown;
  hours_per_sp?: unknown;
  reference_tasks?: unknown;
}

export interface NormalizedStoryPointsConfig {
  enabled: boolean;
  sprintEnabled: boolean;
  values: number[];
  hoursPerSp: StoryPointHours;
  referenceTasks: StoryPointReferenceTasks;
}

/** Only completed tasks are valid team calibration examples. */
export type StoryPointDoneTask = {
  id: string;
  full_id: string;
  title: string;
};

export function defaultStoryPointHours(): StoryPointHours {
  return { ...DEFAULT_STORY_POINT_RANGES };
}

export function storyPointReferenceLabel(reference: StoryPointReferenceTask | undefined): string {
  if (!reference) return 'Не выбрана';
  return `${reference.full_id ?? reference.task_id.slice(0, 8)} · ${reference.title ?? 'Без названия'}`;
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

  const normalizedValues = values.length > 0 ? values : [...DEFAULT_STORY_POINT_VALUES];
  const isLegacyDefault = normalizedValues.length === LEGACY_STORY_POINT_VALUES.length
    && normalizedValues.every((value, index) => value === LEGACY_STORY_POINT_VALUES[index]);
  const normalizedValuesForHours = isLegacyDefault ? [...DEFAULT_STORY_POINT_VALUES] : normalizedValues;

  const rawHours = isRecord(config.hours_per_sp) ? config.hours_per_sp : {};
  const hoursPerSp: StoryPointHours = {};
  for (const [key, value] of Object.entries(rawHours)) {
    const numericKey = Number(key);
    if (!Number.isInteger(numericKey) || !normalizedValuesForHours.includes(numericKey)) continue;
    const range = parseStoryPointTimeRange(value);
    if (range) hoursPerSp[String(numericKey)] = range.normalized;
  }

  const referenceTasks: StoryPointReferenceTasks = {};
  if (isRecord(config.reference_tasks)) {
    for (const [key, value] of Object.entries(config.reference_tasks)) {
      const sp = Number(key);
      if (!Number.isInteger(sp) || !normalizedValuesForHours.includes(sp)) continue;
      if (!isRecord(value) || typeof value.task_id !== 'string' || !value.task_id.trim()) continue;
      referenceTasks[String(sp)] = {
        task_id: value.task_id.trim(),
        full_id: typeof value.full_id === 'string' ? value.full_id : null,
        title: typeof value.title === 'string' ? value.title : null,
      };
    }
  }

  return {
    enabled: config.enabled === true,
    sprintEnabled: config.sprint_enabled === true,
    values: normalizedValuesForHours,
    hoursPerSp,
    referenceTasks,
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
