"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TextInput } from "@/components/ui/TextInput";
import { DateRangeField } from "@/components/ui/DateRangeField";
import { DateRangeSheet } from "@/components/ui/DateRangeSheet";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/sprint/Field";
import { StatBox } from "@/components/sprint/StatBox";
import type { SprintFormValue, SprintStats } from "@/components/sprint/types";

export function SprintEditSheet({
  open,
  onClose,
  initialValue,
  stats,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  initialValue: Omit<SprintFormValue, "capacity">;
  stats: SprintStats;
  onSubmit: (value: Omit<SprintFormValue, "capacity">) => void;
}) {
  const [name, setName] = useState(initialValue.name);
  const [startDate, setStartDate] = useState<Date | null>(
    initialValue.startDate
  );
  const [endDate, setEndDate] = useState<Date | null>(initialValue.endDate);
  const [goal, setGoal] = useState(initialValue.goal);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  // Note: unlike the Creation sheet, there's no "Ёмкость спринта" field
  // here — the reference mockup (IMG_6733) doesn't show one for an
  // already-running sprint. Left this asymmetry as-is rather than
  // "fixing" it to match Creation, since it lines up with how sprint
  // capacity works elsewhere in onitask (rolling velocity-based, not a
  // number you'd hand-edit mid-sprint).
  const canSubmit =
    name.trim().length > 0 && startDate !== null && endDate !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ name, startDate, endDate, goal });
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
              corner="panel"
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
              corner="panel"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Текст плейсхолдера"
            />
          </Field>

          <div className="border-t border-line pt-5">
            <div className="grid grid-cols-2 gap-3">
              <StatBox
                label="Выполнено задач"
                value={`${stats.completedTasks} / ${stats.totalTasks}`}
                valueTone="success"
              />
              <StatBox label="Осталось дней" value={String(stats.daysLeft)} />
            </div>
          </div>

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
