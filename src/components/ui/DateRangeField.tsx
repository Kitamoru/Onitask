'use client';

import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { formatDateRange } from '@/lib/date';

/**
 * DateRangeField — displays a selected date range or a placeholder.
 * Tapping opens the DateRangeSheet.
 */
export function DateRangeField({
  startDate,
  endDate,
  onOpen,
  placeholder = 'Выберите даты',
}: {
  startDate: Date | null;
  endDate: Date | null;
  onOpen: () => void;
  placeholder?: string;
}) {
  const displayValue = formatDateRange(startDate, endDate);
  const isFilled = displayValue !== '';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block h-10 w-full appearance-none border-0 bg-transparent p-0"
      aria-label={displayValue || placeholder}
    >
      <NotchedPanel
        corner="field"
        notch={8}
        fill="var(--color-surface)"
        contentClassName="flex h-full w-full items-center justify-between gap-1.5 px-3"
      >
        <span
          className={
            isFilled
              ? 'text-base tracking-tighter text-text'
              : 'text-base tracking-tighter text-text-muted/50'
          }
        >
          {displayValue || placeholder}
        </span>
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="shrink-0 text-text-muted/50"
        >
          <path
            d="M5 8L10 13L15 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </NotchedPanel>
    </button>
  );
}
