'use client';

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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-[6px] border border-[rgba(255,255,255,0.2)] bg-[#161616] px-4 py-3 text-left text-[15px] transition-colors hover:border-[rgba(255,255,255,0.3)]"
      aria-label={displayValue || placeholder}
    >
      <span
        className={
          displayValue ? 'text-[#FAFAFA]' : 'text-[#8B8B8B]'
        }
      >
        {displayValue || placeholder}
      </span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0 text-[#8B8B8B]"
      >
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
