'use client';

import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui/Button';

/**
 * DateRangeSheet — bottom sheet with a date range picker.
 * Uses react-day-picker v10 with mode="range".
 */
export function DateRangeSheet({
  open,
  onClose,
  startDate,
  endDate,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  startDate: Date | null;
  endDate: Date | null;
  onConfirm: (start: Date, end: Date) => void;
}) {
  const [draft, setDraft] = useState<{ from: Date; to: Date } | null>(null);

  // Reset draft when sheet opens
  const initial = startDate && endDate ? { from: startDate, to: endDate } : null;
  const selected = draft ?? initial ?? undefined;

  const handleSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range?.from || !range?.to) return;
    setDraft({ from: range.from, to: range.to });
  };

  const handleConfirm = () => {
    if (selected?.from && selected?.to) {
      onConfirm(selected.from, selected.to);
    }
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 px-4 pb-6 pt-2">
        <h3 className="text-[17px] font-medium text-text">Выберите даты спринта</h3>

        <DayPicker
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          numberOfMonths={1}
          className="sprint-date-picker"
          modifiersStyles={{
            selected: { 
              backgroundColor: '#0FEE9E', 
              color: '#000',
              borderRadius: '50%',
            },
            range_middle: { 
              backgroundColor: 'rgba(15, 238, 158, 0.2)',
            },
            disabled: { color: '#555' },
          }}
          styles={{
            month: { margin: 0 },
            day: { color: '#FAFAFA' },
          }}
        />

        <Button variant="solid" onClick={handleConfirm} className="w-full">
          Применить
        </Button>
      </div>
    </BottomSheet>
  );
}
