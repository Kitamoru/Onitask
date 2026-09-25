const REASON_LABELS: Record<string, string> = {
  insufficient_context: 'Не хватает информации, чтобы продолжить',
  conflicting_requirements: 'В требованиях есть противоречие',
  blocked_by: 'Задача зависит от другой задачи',
  out_of_scope: 'Задача выходит за рамки возможностей агента',
  max_attempts: 'Не удалось выполнить задачу после трёх попыток',
  unsupported_task: 'Агент не может выполнить эту задачу',
};

export function escalationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Причина не указана';
  return REASON_LABELS[reason] ?? reason.replaceAll('_', ' ');
}

export function escalationSummary(reason: string | null | undefined): string {
  return escalationReasonLabel(reason);
}

export function formatEscalationAge(hoursPending: number): string {
  const safeHours = Math.max(0, Math.floor(hoursPending));
  if (safeHours < 1) return 'меньше часа';
  if (safeHours < 24) return `${safeHours} ч`;
  const days = Math.floor(safeHours / 24);
  const hours = safeHours % 24;
  return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
}
