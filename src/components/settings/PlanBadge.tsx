'use client';

/**
 * PlanBadge — отображает тариф пользователя (Solo | 290₽/мес).
 * Figma: instance "badge" #414:32920 (amber variant)
 * Template: padding 4px, gap 8px, borderRadius 4px, bg rgba(245,158,11,0.2), border #F59E0B
 * Text: Inter Display Medium 12px/14px, #FAFAFA
 */
export function PlanBadge({ planName, price }: { planName: string; price: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-[4px]"
      style={{
        padding: 4,
        backgroundColor: 'rgba(245, 158, 11, 0.2)',
        border: '1px solid #F59E0B',
      }}
      aria-label={`Тариф: ${planName}`}
    >
      <span
        className="text-xs font-medium leading-[14px] text-white"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 12,
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {planName} | {price}
      </span>
    </div>
  );
}
