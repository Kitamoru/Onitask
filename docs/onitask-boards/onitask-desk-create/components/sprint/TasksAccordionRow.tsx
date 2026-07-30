"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { NotchedPanel } from "@/components/ui/NotchedPanel";
import { CountBadge } from "@/components/ui/CountBadge";
import { cn } from "@/lib/cn";

/**
 * The reference mockup (IMG_6734) only shows this row collapsed, with
 * "0 задач" — no screenshot shows what the expanded state looks like.
 * Implemented as a generic accordion that reveals `children` when open,
 * with a sensible empty-state fallback when there's nothing to show —
 * this is a judgment call, not something the mockups specify; swap the
 * empty-state copy/children for whatever the real task-picker UI ends
 * up being.
 */
export function TasksAccordionRow({
  taskCount,
  children,
}: {
  taskCount: number;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <NotchedPanel corner="field" fill="var(--color-surface)" contentClassName="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-text-muted transition-transform duration-200",
              open && "rotate-180"
            )}
          />
          <span className="text-[15px] font-medium text-text">
            Задачи спринта
          </span>
        </span>
        <CountBadge>{taskCount} задач</CountBadge>
      </button>

      {open && (
        <div className="mt-3 border-t border-line pt-3">
          {children ?? (
            <p className="py-2 text-center text-[13px] text-text-faint">
              Пока нет задач в спринте
            </p>
          )}
        </div>
      )}
    </NotchedPanel>
  );
}
