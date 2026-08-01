'use client';

import { SquarePen } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui/Button';
import { CountBadge } from '@/components/ui/desk-ui/CountBadge';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { StatBox } from '@/components/sprint/StatBox';
import { formatDateRange } from '@/lib/date';
import type { SprintFormValue, SprintStats } from '@/components/sprint/types';

export function SprintViewSheet({
  open,
  onClose,
  sprint,
  stats,
  isActive,
  status,
  onEdit,
  onComplete,
  onActivate,
}: {
  open: boolean;
  onClose: () => void;
  sprint: Omit<SprintFormValue, 'capacity'>;
  stats: SprintStats;
  isActive: boolean;
  /** Sprint status: 'planning' | 'active' | 'completed' */
  status?: string;
  onEdit: () => void;
  onComplete: () => void;
  onActivate?: () => void;
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
          {status === 'active' && (
            <span className="rounded-[10px] border border-line bg-success/15 px-3 py-1.5 text-[13px] text-success">
              Активный
            </span>
          )}
          {status === 'planning' && (
            <span className="rounded-[10px] border border-line bg-amber/15 px-3 py-1.5 text-[13px] text-amber">
              Запланирован
            </span>
          )}
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
            {sprint.goal || 'Цель не указана'}
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
          {/* Progress bar */}
          <div
            className="w-full relative overflow-hidden"
            style={{ height: '8px', borderRadius: '4px' }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="w-full h-full"
              style={{
                backgroundColor: 'var(--color-text-muted, #8B8B8B)',
                opacity: 0.2,
              }}
            />
            <div
              className="absolute top-0 left-0 h-full transition-all duration-300"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: 'var(--color-accent, #0FEE9E)',
                borderRadius: '4px',
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {(status === 'planning' || (!status && !isActive)) && onActivate && (
            <>
              <Button variant="solid" onClick={onActivate}>
                Активировать спринт
              </Button>
              <p className="text-center text-[12px] leading-[1.5] text-text-faint">
                После активации спринт можно будет завершить
              </p>
            </>
          )}
          {(status === 'active' || isActive) && (
            <>
              <Button variant="solid" onClick={onComplete}>
                Завершить спринт
              </Button>
              <p className="text-center text-[12px] leading-[1.5] text-text-faint">
                Завершение архивирует текущий спринт
              </p>
            </>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}