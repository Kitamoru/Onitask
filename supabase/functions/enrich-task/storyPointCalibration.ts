export interface StoryPointCalibrationConfig {
  enabled?: boolean;
  values?: number[];
  hours_per_sp?: Record<string, string>;
  reference_tasks?: Record<string, { task_id: string; full_id?: string | null; title?: string | null }>;
}

const DEFAULT_VALUES = [1, 2, 3, 5, 8];
const DEFAULT_RANGES: Record<string, string> = {
  1: '1–2 часа',
  2: '2–4 часа',
  3: '4–8 часов',
  5: '8–16 часов',
  8: '16–32 часа',
};

const RANGE_PATTERN = /^\s*(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*(\d+(?:[.,]\d+)?))?\s*(?:ч(?:ас(?:а|ов)?)?\.?)\s*$/iu;

function safeHoursWord(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'час';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'часа';
  return 'часов';
}

function safeRange(value: unknown): string {
  if (typeof value !== 'string') return 'не задан';
  const match = RANGE_PATTERN.exec(value.trim());
  if (!match) return 'не задан';
  const min = Number(match[1].replace(',', '.'));
  const max = match[2] === undefined ? min : Number(match[2].replace(',', '.'));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min > max || max > 720) {
    return 'не задан';
  }
  return `${min}–${max} ${safeHoursWord(max)}`;
}

/** Builds the F-03 prompt block without exposing settings as instructions. */
export function buildStoryPointCalibrationBlock(config: StoryPointCalibrationConfig | null | undefined): string {
  if (!config?.enabled) {
    return JSON.stringify({ enabled: false });
  }

  const values = config.values ?? DEFAULT_VALUES;
  const timeRanges = Object.fromEntries(
    values.map((value) => [String(value), safeRange(config.hours_per_sp?.[String(value)] || DEFAULT_RANGES[String(value)])]),
  );
  const referenceTasks = config.reference_tasks ?? {};
  return JSON.stringify({
    enabled: true,
    values,
    time_ranges: timeRanges,
    reference_tasks: referenceTasks,
    usage: 'Reference tasks first, then time ranges as duration guidance, then generic SP anchors. Boundaries require relative complexity analysis.',
  });
}
