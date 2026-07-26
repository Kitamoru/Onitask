'use client';

/**
 * UrgencyBadge — traffic light indicator based on deadline proximity (FLOW-07).
 *
 * Colors:
 *   - red: deadline passed or within 24 hours
 *   - amber: deadline within 48 hours
 *   - green: deadline further away or no deadline
 *
 * Based on: product_vision US-04, TASKS.md Stage 4 FLOW-07
 */

interface UrgencyBadgeProps {
  deadline: string | null;
  size?: 'sm' | 'md' | 'lg';
}

export function UrgencyBadge({ deadline, size = 'sm' }: UrgencyBadgeProps) {
  if (!deadline) return null;

  const now = new Date();
  const dl = new Date(deadline);
  const diffMs = dl.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let color: 'red' | 'amber' | 'green';
  let label: string;

  if (diffMs <= 0) {
    color = 'red';
    const diffDays = Math.abs(diffHours) / 24;
    label = diffDays >= 1 ? `Просрочено на ${Math.floor(diffDays)}д` : 'Просрочено';
  } else if (diffHours <= 24) {
    color = 'red';
    label = `Критично: ${Math.floor(diffHours)}ч`;
  } else if (diffHours <= 48) {
    color = 'amber';
    label = `Срок: ${Math.floor(diffHours)}ч`;
  } else {
    color = 'green';
    const diffDays = diffHours / 24;
    label = `Через ${Math.ceil(diffDays)}д`;
  }

  const sizeMap = {
    sm: { dot: 'var(--spacing-1\\.5)', paddingX: 'var(--spacing-1\\.5)', fontSize: 'var(--text-body-xs)' },
    md: { dot: 'var(--spacing-2)', paddingX: 'var(--spacing-2)', fontSize: 'var(--text-body-xs)' },
    lg: { dot: 'var(--spacing-2\\.5)', paddingX: 'var(--spacing-2\\.5)', fontSize: 'var(--text-body-sm)' },
  };

  const s = sizeMap[size];

  const colorMap = {
    red: { bg: 'var(--color-priority-red-bg)', border: 'var(--color-signal-red)', text: 'var(--color-signal-red)', dot: 'var(--color-signal-red)' },
    amber: { bg: 'var(--color-priority-amber-bg)', border: 'var(--color-signal-yellow)', text: 'var(--color-signal-yellow)', dot: 'var(--color-signal-yellow)' },
    green: { bg: 'var(--color-priority-green-bg)', border: 'var(--color-signal-green)', text: 'var(--color-signal-green)', dot: 'var(--color-signal-green)' },
  };

  const c = colorMap[color];

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border transition-colors"
      style={{
        backgroundColor: c.bg,
        borderColor: c.border,
        paddingLeft: s.paddingX,
        paddingRight: s.paddingX,
        paddingTop: 'var(--spacing-0\\.5)',
        paddingBottom: 'var(--spacing-0\\.5)',
      }}
      aria-label={`Срочность: ${label}`}
      role="status"
    >
      <div
        className="shrink-0 rounded-full"
        style={{
          width: s.dot,
          height: s.dot,
          backgroundColor: c.dot,
        }}
        aria-hidden="true"
      />
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: s.fontSize,
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: c.text,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * getUrgencyColor — utility to compute urgency color from a deadline string.
 */
export function getUrgencyColor(deadline: string | null): 'red' | 'amber' | 'green' | null {
  if (!deadline) return null;

  const now = new Date();
  const dl = new Date(deadline);
  const diffMs = dl.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs <= 0 || diffHours <= 24) return 'red';
  if (diffHours <= 48) return 'amber';
  return 'green';
}
