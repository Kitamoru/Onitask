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
    sm: { dot: 6, paddingX: 6, fontSize: 10 },
    md: { dot: 8, paddingX: 8, fontSize: 11 },
    lg: { dot: 10, paddingX: 10, fontSize: 12 },
  };

  const s = sizeMap[size];

  const colorMap = {
    red: { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', text: '#FCA5A5', dot: '#EF4444' },
    amber: { bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B', text: '#FCD34D', dot: '#F59E0B' },
    green: { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ADE80', text: '#86EFAC', dot: '#4ADE80' },
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
        paddingTop: 2,
        paddingBottom: 2,
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
          lineHeight: '12px',
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