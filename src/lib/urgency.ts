// src/lib/urgency.ts — единый источник логики «светофора» дедлайнов (BOT-11).
// Пороги берутся из workspace_settings.deadline_signals (миг. 007):
//   red  (urgentDays)   — дедлайн прошёл или осталось ≤ urgentDays дней;
//   amber (warningDays) — осталось ≤ warningDays дней;
//   green               — дальше порога (или дедлайна нет).
// Совпадает с зонами public.deadline_notify_tick() (миг. 090).

export type UrgencyLevel = 'green' | 'amber' | 'red';

export interface DeadlineThresholds {
  /** Жёлтая зона: дней до дедлайна (миг. 007, дефолт 3). */
  warningDays: number;
  /** Красная зона: дней до дедлайна (миг. 007, дефолт 1). */
  urgentDays: number;
}

export const DEFAULT_DEADLINE_THRESHOLDS: DeadlineThresholds = {
  warningDays: 3,
  urgentDays: 1,
};

/**
 * Извлечь пороги из workspace_settings.deadline_signals
 * (массив [{value, label, level: 'amber'|'red'}]).
 * Некорректные/отсутствующие значения → дефолты миграции 007.
 */
export function thresholdsFromSignals(signals: unknown): DeadlineThresholds {
  const result = { ...DEFAULT_DEADLINE_THRESHOLDS };
  if (!Array.isArray(signals)) return result;
  for (const s of signals) {
    const value = Number((s as { value?: unknown })?.value);
    if (!Number.isFinite(value) || value < 1) continue;
    const level = (s as { level?: unknown })?.level;
    if (level === 'amber') result.warningDays = Math.floor(value);
    else if (level === 'red') result.urgentDays = Math.floor(value);
  }
  return result;
}

/**
 * Уровень срочности по дедлайну и порогам светофора.
 * null → дедлайна нет.
 */
export function getUrgencyLevel(
  deadline: Date | string | null,
  thresholds: DeadlineThresholds = DEFAULT_DEADLINE_THRESHOLDS,
): UrgencyLevel | null {
  if (!deadline) return null;
  const dl = new Date(deadline);
  if (Number.isNaN(dl.getTime())) return null;

  const hoursLeft = (dl.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft <= thresholds.urgentDays * 24) return 'red';
  if (hoursLeft <= thresholds.warningDays * 24) return 'amber';
  return 'green';
}

/** Русская плюрализация: 1 день / 2–4 дня / 5+ дней. */
export function pluralDaysRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}
