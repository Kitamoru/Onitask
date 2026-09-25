"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { TextInput } from "@/components/ui/desk-ui/TextInput";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import {
  DEFAULT_STORY_POINT_RANGES,
  DEFAULT_STORY_POINT_VALUES,
  storyPointReferenceLabel,
  storyPointTimeRangeError,
  type StoryPointReferenceTask,
  type StoryPointReferenceTasks,
  type StoryPointDoneTask,
} from "@/lib/storyPoints";

export function StoryPointCostCard({
  enabled,
  onEnabledChange,
  hoursBySp,
  onHoursChange,
  referenceTasks = {},
  onReferenceTaskChange,
  doneTasks = [],
  disabled = false,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  hoursBySp: Record<string, string>;
  onHoursChange: (sp: number, value: string) => void;
  referenceTasks?: StoryPointReferenceTasks;
  onReferenceTaskChange?: (sp: number, task: StoryPointReferenceTask | null) => void;
  doneTasks?: StoryPointDoneTask[];
  disabled?: boolean;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">Ориентиры времени для Story Points</span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Ориентиры времени для Story Points"
          disabled={disabled}
        />
      </div>
      <p className="mb-4 text-[13px] leading-[1.45] text-text-muted">
        Story Points — относительная оценка сложности по шкале 1, 2, 3, 5, 8. Укажите для каждого значения ориентир времени и одну завершённую задачу-эталон, чтобы агент учитывал калибровку команды.
      </p>

      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${enabled ? "max-h-[900px] opacity-100" : "max-h-0 opacity-0"}`} aria-hidden={!enabled}>
        <div className="flex flex-col gap-4">
          {DEFAULT_STORY_POINT_VALUES.map((sp) => {
            const value = hoursBySp[String(sp)] ?? DEFAULT_STORY_POINT_RANGES[String(sp)];
            const rangeError = storyPointTimeRangeError(value);
            return (
            <div key={sp}>
              <label className="mb-1 block text-[13px] text-text">{sp} SP</label>
              <TextInput
                value={value}
                onChange={(e) => onHoursChange(sp, e.target.value)}
                placeholder={DEFAULT_STORY_POINT_RANGES[String(sp)]}
                disabled={disabled}
                inputMode="text"
                aria-invalid={Boolean(rangeError)}
                className={rangeError ? 'text-[var(--color-priority-red-text)]' : undefined}
              />
              {rangeError && (
                <p className="mt-1 text-[11px] text-[var(--color-priority-red-text)]" role="alert">
                  {rangeError}
                </p>
              )}
              {onReferenceTaskChange && (
                <div className="mt-2 flex flex-col gap-1">
                  <label className="text-[12px] text-text-muted">Эталон команды</label>
                  <TaskReferencePicker
                    sp={sp}
                    value={referenceTasks[String(sp)]}
                    referenceTasks={referenceTasks}
                    onChange={(task) => onReferenceTaskChange(sp, task)}
                    doneTasks={doneTasks}
                    enabled={enabled}
                    disabled={disabled}
                  />
                  <span className="text-[11px] text-text-muted">
                    Только завершённые задачи. Эталон помогает агенту понять, что команда считает задачей этого размера.
                  </span>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function TaskReferencePicker({
  sp,
  value,
  referenceTasks,
  onChange,
  doneTasks,
  enabled,
  disabled,
}: {
  sp: number;
  value?: StoryPointReferenceTask;
  referenceTasks: StoryPointReferenceTasks;
  onChange: (task: StoryPointReferenceTask | null) => void;
  doneTasks: StoryPointDoneTask[];
  enabled: boolean;
  disabled: boolean;
}) {
  return (
    <select
      value={value?.task_id ?? ''}
      onChange={(event) => {
        const task = doneTasks.find((item) => item.id === event.target.value);
        onChange(task ? { task_id: task.id, full_id: task.full_id, title: task.title } : null);
      }}
      disabled={disabled || !enabled}
      className="h-10 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-text"
      aria-label={`Эталон для ${sp} SP`}
    >
      <option value="">Не выбрана</option>
      {doneTasks.map((task) => {
        const usedFor = Object.entries(referenceTasks)
          .find(([, reference]) => reference.task_id === task.id)?.[0];
        return (
          <option key={task.id} value={task.id} disabled={usedFor !== undefined && usedFor !== String(sp)}>
            {storyPointReferenceLabel({ task_id: task.id, full_id: task.full_id, title: task.title })}
            {usedFor !== undefined && usedFor !== String(sp) ? ` · уже выбран для ${usedFor} SP` : ''}
          </option>
        );
      })}
    </select>
  );
}
