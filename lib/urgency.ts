// getUrgency(dueDate, settings) — клиент
// Calculates urgency level (low/medium/high/critical) based on deadline and workspace settings

export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export function getUrgency(dueDate: Date | null, settings: {urgencyBufferHours?: number}): UrgencyLevel {
  if (!dueDate) return 'low';

  const now = new Date();
  const hoursLeft = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  const buffer = settings.urgencyBufferHours ?? 24;

  if (hoursLeft <= buffer * 0.25) return 'critical';
  if (hoursLeft <= buffer * 0.5) return 'high';
  if (hoursLeft <= buffer) return 'medium';
  return 'low';
}