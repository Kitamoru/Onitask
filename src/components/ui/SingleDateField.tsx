'use client';

import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { formatDateLong } from '@/lib/date';

/**
 * SingleDateField — displays a selected date or a placeholder.
 * Tapping opens the SingleDateSheet.
 */
export function SingleDateField({
  date,
  onOpen,
  placeholder = 'Дата окончания',
  disabled = false,
}: {
  date: Date | null;
  onOpen: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const displayValue = formatDateLong(date);
  const isFilled = displayValue !== '';

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-disabled={disabled}
      className="block w-full appearance-none border-0 bg-transparent p-0"
      aria-label={displayValue || placeholder}
    >
      <NotchedPanel
        corner="field"
        notch={8}
        fill="var(--color-surface)"
        className="w-full"
      >
        <div
          className="flex h-10 w-full items-center justify-between gap-1.5 px-3"
          style={{ opacity: disabled ? 0.6 : 1 }}
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
        </div>
      </NotchedPanel>
    </button>
  );
}