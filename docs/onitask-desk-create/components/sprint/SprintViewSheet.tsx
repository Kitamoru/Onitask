"use client";

import { SquarePen } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/CountBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { NotchedPanel } from "@/components/ui/NotchedPanel";
import { StatBox } from "@/components/sprint/StatBox";
import { formatDateRange } from "@/lib/date";
import type { SprintFormValue, SprintStats } from "@/components/sprint/types";

export function SprintViewSheet({
  open,
  onClose,
  sprint,
  stats,
  isActive,
  onEdit,
  onComplete,
  onCreateNew,
}: {
  open: boolean;
  onClose: () => void;
  sprint: Omit<SprintFormValue, "capacity">;
  stats: SprintStats;
  isActive: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onCreateNew: () => void;
}) {
  const progressPercent =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Редактировать спринт"
              className="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted"
            >
              <SquarePen className="h-[18px] w-[18px]" />
            </button>
            <h2 className="text-[17px] font-medium text-text">
              {sprint.name}
            </h2>
          </div>
          {isActive && <CountBadge tone="success">Активный</CountBadge>}
        </div>

        <p className="text-[14px] text-text-muted">
          {formatDateRange(sprint.startDate, sprint.endDate)}
        </p>

        <NotchedPanel
          corner="field"
          fill="var(--color-surface)"
          contentClassName="flex flex-col gap-1 px-4 py-3"
        >
          <span className="text-[13px] text-text-muted">Цель спринта</span>
          <span className="text-[15px] font-medium text-text">
            {sprint.goal || "Цель не указана"}
          </span>
        </NotchedPanel>

        <div className="border-t border-line pt-4">
          <div className="mb-4 grid grid-cols-3 gap-2.5">
            <StatBox
              label="Выполнено задач"
              value={`${stats.completedTasks}/${stats.totalTasks}`}
              valueTone="success"
            />
            <StatBox label="Осталось дней" value={String(stats.daysLeft)} />
            <StatBox
              label="Прогресс спринта"
              value={`${progressPercent}%`}
            />
          </div>
          <ProgressBar percent={progressPercent} />
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Button variant="solid" onClick={onComplete}>
            Завершить спринт
          </Button>
          <Button variant="outline" onClick={onCreateNew}>
            Создать новый спринт
          </Button>
          <p className="text-center text-[12px] leading-[1.5] text-text-faint">
            Завершение архивирует текущий спринт
            <br />
            Новый спринт можно запланировать и запустить позже
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}
