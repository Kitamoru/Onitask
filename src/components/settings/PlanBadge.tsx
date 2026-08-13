'use client';

/**
 * PlanBadge — отображает тариф пользователя (Solo | 290₽/мес).
 * Figma: instance "badge" #17:8819
 */
export function PlanBadge({ planName, price }: { planName: string; price: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded px-1 py-[4px]"
      style={{
        backgroundColor: 'rgba(245, 158, 11, 0.2)',
        border: '1px solid #F59E0B',
        borderRadius: '4px',
      }}
      aria-label={`Тариф: ${planName}`}
    >
      <span
        className="text-sm font-medium leading-[14px] text-white"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {planName} | {price}
      </span>
    </div>
  );
}