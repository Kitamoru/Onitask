'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';

/**
 * TasksAccordionRow — controlled accordion row showing task count and expandable list.
 * Used in SprintCreateSheet / SprintEditSheet to pick tasks for the sprint.
 * Matches the Figma "sprint-tasks" component: header with chevron + badge,
 * wrapped in a NotchedPanel (ref-bg-shape-outer equivalent).
 */
export function TasksAccordionRow({
  taskCount,
  tasks = [],
  selectedIds = [],
  onToggle,
}: {
  taskCount: number;
  tasks?: Array<{ id: string; title: string; full_id: string }>;
  /** IDs of currently selected tasks */
  selectedIds?: string[];
  /** Toggle callback: called with the task ID when a checkbox is clicked */
  onToggle?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const countLabel = `${taskCount} ${pluralize(taskCount)}`;

  return (
    <NotchedPanel
      corner="field"
      notch={8}
      fill="var(--color-surface)"
      contentClassName="w-full"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          {open ? (
            <ChevronUp className="h-6 w-6 shrink-0 text-text-muted" />
          ) : (
            <ChevronDown className="h-6 w-6 shrink-0 text-text-muted" />
          )}
          <span className="font-display text-base font-medium leading-5 text-text">
            Задачи спринта
          </span>
        </span>
        <span className="flex items-center gap-2 rounded-[4px] border border-text-secondary/60 bg-text-secondary/20 px-1 py-0.5">
          <span className="text-xs font-medium leading-[0.875rem] text-text-secondary">
            {countLabel}
          </span>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {tasks.length === 0 ? (
            <p className="py-3 text-center text-sm text-text-muted">
              Нет доступных задач для добавления
            </p>
          ) : (
            tasks.map((task) => (
              <TaskCheckboxItem
                key={task.id}
                task={task}
                checked={selectedIds.includes(task.id)}
                onToggle={onToggle}
              />
            ))
          )}
        </div>
      )}
    </NotchedPanel>
  );
}

function pluralize(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'задача';
  if (
    count % 10 >= 2 &&
    count % 10 <= 4 &&
    (count % 100 < 10 || count % 100 >= 20)
  )
    return 'задачи';
  return 'задач';
}

function TaskCheckboxItem({
  task,
  checked,
  onToggle,
}: {
  task: { id: string; title: string; full_id: string };
  checked: boolean;
  onToggle?: (id: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          e.stopPropagation();
          onToggle?.(task.id);
        }}
        className="sr-only"
      />
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
          checked
            ? 'border-accent bg-accent'
            : 'border-line bg-transparent'
        }`}
      >
        {checked && (
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
            <path
              d="M1 5L4.5 8.5L11 1.5"
              stroke="#000"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-text">{task.title}</span>
          <span className="text-xs text-text-muted">{task.full_id}</span>
        </div>
    </label>
  );
}