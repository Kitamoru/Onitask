'use client';

import { useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextInput } from '@/components/ui/desk-ui/TextInput';
import { DateRangeField } from '@/components/ui/DateRangeField';
import { DateRangeSheet } from '@/components/ui/DateRangeSheet';
import { Button } from '@/components/ui/desk-ui/Button';
import { Field } from '@/components/sprint/Field';
import { TasksAccordionRow } from '@/components/sprint/TasksAccordionRow';
import type { SprintFormValue } from '@/components/sprint/types';

export function SprintEditSheet({
  open,
  onClose,
  initialValue,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  initialValue: SprintFormValue;
  onSubmit: (value: SprintFormValue) => void;
}) {
  const [name, setName] = useState(initialValue.name);
  const [startDate, setStartDate] = useState<Date | null>(
    initialValue.startDate,
  );
  const [endDate, setEndDate] = useState<Date | null>(initialValue.endDate);
  const [goal, setGoal] = useState(initialValue.goal);
  const [capacity, setCapacity] = useState(initialValue.capacity ?? '');
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  const canSubmit =
    name.trim().length > 0 && startDate !== null && endDate !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ name, startDate, endDate, goal, capacity });
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div className="flex flex-col gap-5 px-4 pb-6 pt-6">
          <h2 className="text-[19px] font-medium text-text">
            Редактирование спринта
          </h2>

          <Field label="Название спринта">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введите название спринта"
            />
          </Field>

          <Field label="Даты спринта">
            <DateRangeField
              startDate={startDate}
              endDate={endDate}
              onOpen={() => setDateSheetOpen(true)}
              placeholder="Выберите даты"
            />
          </Field>

          <Field label="Цель спринта">
            <TextInput
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Введите цель спринта"
            />
          </Field>

          <Field label="Ёмкость спринта">
            <TextInput
              value={capacity}
              onChange={(e) => setCapacity(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="0"
              inputMode="numeric"
            />
          </Field>

          <TasksAccordionRow taskCount={0} />

          <Button variant="solid" disabled={!canSubmit} onClick={handleSubmit}>
            Сохранить спринт
          </Button>
        </div>
      </BottomSheet>

      <DateRangeSheet
        open={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        startDate={startDate}
        endDate={endDate}
        onConfirm={(s, e) => {
          setStartDate(s);
          setEndDate(e);
          setDateSheetOpen(false);
        }}
      />
    </>
  );
}