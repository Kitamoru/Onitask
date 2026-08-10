'use client';

/**
 * ProgressSteps — step progress bar (Figma "progressbar" 439:33993).
 *
 * Used in task-create wizard to show the current stage (1..3).
 * Active stage is amber (#F59E0B), inactive stages are amber at 20% opacity.
 */

export function ProgressSteps({
  current,
  total = 3,
  className = '',
}: {
  /** Current step (1-based) */
  current: number;
  /** Total number of steps */
  total?: number;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={Math.min(Math.max(current, 1), total)}
      aria-label={`Шаг ${Math.min(Math.max(current, 1), total)} из ${total}`}
      className={`flex w-full items-stretch gap-1 ${className}`}
      style={{ height: 8 }}
    >
      {Array.from({ length: total }, (_, i) => {
        const isActive = i < current;
        return (
          <div
            key={i}
            className="flex-1"
            style={{
              backgroundColor: isActive ? '#F59E0B' : 'rgba(245, 158, 11, 0.2)',
              borderRadius: 4,
            }}
          />
        );
      })}
    </div>
  );
}