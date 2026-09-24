export interface TaskBlockedBadgeProps {
  className?: string;
}

/** Compact pure-red state badge for tasks that still have an active blocker. */
export function TaskBlockedBadge({ className = '' }: TaskBlockedBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 font-display text-body-sm font-medium whitespace-nowrap ${className}`.trim()}
      style={{
        color: 'var(--color-blocked-badge-text)',
        backgroundColor: 'var(--color-blocked-badge-bg)',
        border: '1px solid var(--color-blocked-badge-border)',
        borderRadius: 'var(--radius-flowboard-section)',
      }}
      aria-label="Состояние: Заблокирована"
    >
      Заблокирована
    </span>
  );
}
