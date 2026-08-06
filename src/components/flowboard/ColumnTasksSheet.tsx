'use client';

import { useCallback, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SwipeableTaskCard } from '@/components/flowboard/SwipeableTaskCard';
import type { TaskEntity } from '@/types/flowboard';

/**
 * ColumnTasksSheet — bottom sheet listing tasks from a specific column.
 *
 * Figma node 240:27222 "[task-type] / tasks":
 *   - Container: column, maxWidth 390, bg #0A0A0A @ 80%, padding 24px 16px 32px
 *   - Header: colored shape (10×7) + title "Активные" etc (Inter Display 20/24 Medium)
 *   - List: column, gap 8px, task-cards
 *
 * Uses SwipeableTaskCard for swipe-to-move gestures.
 * All values relative (gap, %, var(--spacing-*)) for adaptive design.
 */

export interface ColumnTasksSheetProps {
  open: boolean;
  onClose: () => void;
  /** Column key: in_progress | backlog | review | done */
  column: string | null;
  /** Title shown in the header, e.g. "Активные" */
  title: string;
  /** Tasks belonging to this column */
  tasks: TaskEntity[];
  /** Accent color for the header shape */
  accentColor?: string;
  /** Callback when a task is moved to a different column */
  onMoveTask?: (taskId: string, newColumn: string) => void;
  /** Callback when a task card is tapped */
  onTaskTap?: (taskId: string) => void;
}

const COLUMN_ORDER: string[] = ['backlog', 'in_progress', 'review', 'done'];

const COLUMN_ACCENTS: Record<string, string> = {
  in_progress: 'var(--color-accent-amber)',
  backlog: 'var(--color-text-primary)',
  review: 'var(--color-signal-cyan)',
  done: 'var(--color-signal-green)',
};

export function ColumnTasksSheet({
  open,
  onClose,
  column,
  title,
  tasks,
  accentColor,
  onMoveTask,
  onTaskTap,
}: ColumnTasksSheetProps) {
  const color = accentColor ?? (column ? COLUMN_ACCENTS[column] : 'var(--color-accent-amber)');

  const handleMoveNext = useCallback(
    (taskId: string) => {
      if (!column) return;
      const currentIndex = COLUMN_ORDER.indexOf(column);
      if (currentIndex < 0 || currentIndex >= COLUMN_ORDER.length - 1) return;
      const nextColumn = COLUMN_ORDER[currentIndex + 1];
      onMoveTask?.(taskId, nextColumn);
    },
    [column, onMoveTask]
  );

  const handleMovePrev = useCallback(
    (taskId: string) => {
      if (!column) return;
      const currentIndex = COLUMN_ORDER.indexOf(column);
      if (currentIndex <= 0) return;
      const prevColumn = COLUMN_ORDER[currentIndex - 1];
      onMoveTask?.(taskId, prevColumn);
    },
    [column, onMoveTask]
  );

  const handleTap = useCallback(
    (taskId: string) => {
      onTaskTap?.(taskId);
    },
    [onTaskTap]
  );

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-4 pb-6" role="region" aria-label={`Задачи: ${title}`}>
        {/* Header — Figma 240:27500: colored shape + title */}
        <div className="flex w-full items-center gap-2">
          <div
            className="shrink-0"
            style={{
              width: '10px',
              height: '7px',
              borderRadius: '2px',
              backgroundColor: color,
            }}
            aria-hidden="true"
          />
          <h2
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'clamp(18px, 2.5vw, 20px)',
              lineHeight: '24px',
              fontWeight: 'var(--font-weight-medium)',
              letterSpacing: '-0.025em',
              color: 'var(--color-text-primary)',
              margin: 0,
              flex: 1,
            }}
          >
            {title}
          </h2>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              lineHeight: 'var(--text-body-md-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {tasks.length}
          </span>
        </div>

        {/* List of tasks */}
        {tasks.length > 0 ? (
          <div className="flex w-full flex-col gap-2">
            {tasks.map((task) => (
              <SwipeableTaskCard
                key={task.id}
                task={task}
                columnOrder={COLUMN_ORDER}
                currentColumn={column ?? 'backlog'}
                onMoveNext={handleMoveNext}
                onMovePrev={handleMovePrev}
                onTap={handleTap}
              />
            ))}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center justify-center gap-2 py-10">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-md)',
                lineHeight: 'var(--text-body-md-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              В этом столбце пока нет задач
            </span>
            <span
              style={{
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-normal)',
                color: 'var(--color-text-muted)',
              }}
            >
              Создайте задачу или передвиньте её сюда
            </span>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}