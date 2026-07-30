'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

/**
 * TasksAccordionRow — accordion row showing task count and expandable list.
 * Used in SprintCreateSheet to pick tasks for the sprint.
 */
export function TasksAccordionRow({
  taskCount,
  tasks = [],
}: {
  taskCount: number;
  tasks?: Array<{ id: string; title: string; full_id: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-line pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="text-[15px] font-medium text-text">
          Задачи спринта ({taskCount})
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {tasks.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-text-muted">
              Нет доступных задач для добавления
            </p>
          ) : (
            tasks.map((task) => (
              <TaskCheckboxItem key={task.id} task={task} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TaskCheckboxItem({
  task,
}: {
  task: { id: string; title: string; full_id: string };
}) {
  const [checked, setChecked] = useState(false);

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
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
        <span className="text-[14px] font-medium text-text">{task.full_id}</span>
        <span className="text-[12px] text-text-muted">{task.title}</span>
      </div>
    </label>
  );
}