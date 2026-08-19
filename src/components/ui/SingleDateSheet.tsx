'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { addMonths, formatDateLong, stripTime } from '@/lib/date';

/**
 * SingleDateSheet — pick a single date (task deadline).
 * Similar UX to DateRangeSheet, but only one day can be selected.
 */
export function SingleDateSheet({
  open,
  onClose,
  date,
  onConfirm,
  minDate,
}: {
  open: boolean;
  onClose: () => void;
  date: Date | null;
  onConfirm: (date: Date) => void;
  minDate?: Date;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => date ?? new Date());
  const [draft, setDraft] = useState<Date | null>(date);

  const handleDayClick = (day: Date) => {
    setDraft(stripTime(day));
  };

  const handleConfirm = () => {
    if (draft) {
      onConfirm(draft);
      onClose();
    }
  };

  const canConfirm = !!draft;

  return (
    <BottomSheet open={open} onClose={onClose} stacked>
      <div className="flex flex-col gap-5 px-4 pb-6 pt-6">
        <div>
          <h2 className="mb-1 text-[19px] font-medium text-text">
            Дата окончания
          </h2>
          <p className="text-[14px] text-text-muted">
            {draft ? formatDateLong(draft) : 'Выберите дату окончания задачи'}
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
            {visibleMonth.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
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
          rangeStart={draft}
          rangeEnd={null}
          onDayClick={handleDayClick}
          minDate={minDate}
        />

        <div className="flex gap-3">
          <div className="flex-1">
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null);
              }}
            >
              Сбросить
            </Button>
          </div>
          <div className="flex-1">
             <Button
               variant="solid"
               disabled={!canConfirm}
               onClick={handleConfirm}
             >
               Готово
             </Button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}