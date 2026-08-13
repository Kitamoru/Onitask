'use client';

import { useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextInput } from '@/components/ui/desk-ui/TextInput';
import { DateRangeField } from '@/components/ui/DateRangeField';
import { DateRangeSheet } from '@/components/ui/DateRangeSheet';
import { Button } from '@/components/ui/desk-ui/Button';
import { Field } from '@/components/sprint/Field';
import { TasksAccordionRow } from '@/components/sprint/TasksAccordionRow';
import { useData } from '@/contexts/DataContext';
import type { SprintFormValue } from '@/components/sprint/types';

export function SprintCreateSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: SprintFormValue) => void;
}) {
  const { state } = useData();
  const taskEntities = state.tasks.items;

  const taskList = taskEntities.map((t) => ({
    id: t.id,
    title: t.title ?? '(без названия)',
    full_id: t.full_id ?? t.id.slice(0, 8),
  }));

  const taskCount = taskList.length;
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [goal, setGoal] = useState('');
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  const canSubmit =
    name.trim().length > 0 && startDate !== null && endDate !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      name,
      startDate,
      endDate,
      goal: goal || undefined,
      taskIds: selectedTaskIds.length > 0 ? selectedTaskIds : undefined,
    });
  };

  const handleToggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div className="flex flex-col gap-5 px-4 pb-6 pt-6">
          <h2 className="text-[19px] font-medium text-text">
            Создание спринта
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

          <TasksAccordionRow
            taskCount={taskCount}
            tasks={taskList}
            selectedIds={selectedTaskIds}
            onToggle={handleToggleTask}
          />

          <Button variant="solid" disabled={!canSubmit} onClick={handleSubmit}>
            Создать спринт
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