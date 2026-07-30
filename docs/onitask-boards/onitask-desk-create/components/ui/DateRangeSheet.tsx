"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Calendar } from "@/components/ui/Calendar";
import { addMonths, formatDateRange, monthLabel, stripTime } from "@/lib/date";

/**
 * Why a custom calendar sheet instead of native <input type="date">:
 *
 * 1. The field holds a RANGE ("19.05.2026 — 26.05.2026"), and native
 *    date inputs have no range concept at all — you'd need two separate
 *    native pickers, and on a small screen it's easy to lose track of
 *    which end you're currently setting.
 * 2. Native date inputs render wildly inconsistently across Android
 *    WebView versions inside Telegram — often as a light-themed OS
 *    control that clashes hard with this dark UI. This project has
 *    already avoided native controls elsewhere for the same reason
 *    (see README notes on Tailwind v4 → v3.4 and textarea autosize).
 * 3. A single-month grid where you tap a start day then an end day,
 *    with the days between visually connected, is the standard
 *    (Airbnb/booking-site style) pattern for range entry on touch —
 *    it's harder to mis-tap than two separate fields, and the
 *    in-progress selection is always visible on screen.
 */
export function DateRangeSheet({
  open,
  onClose,
  startDate,
  endDate,
  onConfirm,
  minDate,
}: {
  open: boolean;
  onClose: () => void;
  startDate: Date | null;
  endDate: Date | null;
  onConfirm: (start: Date, end: Date) => void;
  minDate?: Date;
}) {
  const [visibleMonth, setVisibleMonth] = useState(
    () => startDate ?? new Date()
  );
  const [draftStart, setDraftStart] = useState<Date | null>(startDate);
  const [draftEnd, setDraftEnd] = useState<Date | null>(endDate);

  const handleDayClick = (day: Date) => {
    const clicked = stripTime(day);
    // First tap, or restarting after a complete range was already
    // picked — start a fresh range instead of trying to extend the old
    // one, which is what people actually expect when they tap a new day
    // after already having both ends set.
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(clicked);
      setDraftEnd(null);
      return;
    }
    // Second tap: whichever end is chronologically first becomes start.
    if (clicked < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(clicked);
    } else {
      setDraftEnd(clicked);
    }
  };

  const canConfirm = draftStart && draftEnd;

  return (
    <BottomSheet open={open} onClose={onClose} stacked>
      <div className="flex flex-col gap-5 px-4 pb-6 pt-6">
        <div>
          <h2 className="mb-1 text-[19px] font-medium text-text">
            Даты спринта
          </h2>
          <p className="text-[14px] text-text-muted">
            {draftStart
              ? formatDateRange(draftStart, draftEnd)
              : "Выберите начало и конец спринта"}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Предыдущий месяц"
            onClick={() => setVisibleMonth((m) => addMonths(m, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-full text-text"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-[15px] font-medium text-text">
            {monthLabel(visibleMonth)}
          </span>
          <button
            type="button"
            aria-label="Следующий месяц"
            onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full text-text"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <Calendar
          monthDate={visibleMonth}
          rangeStart={draftStart}
          rangeEnd={draftEnd}
          onDayClick={handleDayClick}
          minDate={minDate}
        />

        <div className="flex gap-3">
          <div className="flex-1">
            <Button
              variant="outline"
              onClick={() => {
                setDraftStart(null);
                setDraftEnd(null);
              }}
            >
              Сбросить
            </Button>
          </div>
          <div className="flex-1">
            <Button
              variant="solid"
              disabled={!canConfirm}
              onClick={() => {
                if (draftStart && draftEnd) onConfirm(draftStart, draftEnd);
              }}
            >
              Готово
            </Button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
