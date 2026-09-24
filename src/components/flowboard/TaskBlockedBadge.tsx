export interface TaskBlockedBadgeProps {
  className?: string;
}

/** Compact amber state badge for tasks that still have an active blocker. */
export function TaskBlockedBadge({ className = '' }: TaskBlockedBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 font-display text-body-sm font-medium whitespace-nowrap ${className}`.trim()}
      style={{
        color: 'var(--color-priority-amber-text)',
        backgroundColor: 'var(--color-priority-amber-bg)',
        border: '1px solid var(--color-priority-amber-border)',
        borderRadius: 'var(--radius-flowboard-section)',
      }}
      aria-label="Состояние: Заблокирована"
    >
      Заблокирована
    </span>
  );
}
