"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import { NotchedPanel } from "@/components/ui/NotchedPanel";
import { cn } from "@/lib/cn";
import { formatDateRange } from "@/lib/date";

export function DateRangeField({
  startDate,
  endDate,
  onOpen,
  placeholder = "Выберите даты",
}: {
  startDate: Date | null;
  endDate: Date | null;
  onOpen: () => void;
  placeholder?: string;
}) {
  const label = formatDateRange(startDate, endDate);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block h-12 w-full appearance-none border-0 bg-transparent p-0 text-left"
    >
      <NotchedPanel corner="panel" fill="var(--color-surface)">
        <div className="flex h-full w-full items-center justify-between px-4">
          <span
            className={cn(
              "truncate text-base",
              label ? "text-text" : "text-text-faint"
            )}
          >
            {label || placeholder}
          </span>
          <CalendarIcon className="h-[18px] w-[18px] shrink-0 text-text-muted" />
        </div>
      </NotchedPanel>
    </button>
  );
}
