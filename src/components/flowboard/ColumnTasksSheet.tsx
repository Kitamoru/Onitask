'use client';

import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import type { TaskEntity } from '@/types/flowboard';

// Lazy-load SwipeableTaskCard to avoid SSR serialization issues with useRef
const SwipeableTaskCard = lazy(() =>
  import('@/components/flowboard/SwipeableTaskCard').then((mod) => ({ default: mod.SwipeableTaskCard })),
);

/**
 * ColumnTasksSheet — bottom sheet listing tasks from a specific column.
 *
 * Optimistic UI: при свайпе задачи она мгновенно перемещается между колонками
 * на клиенте (через swappedTasks), не дожидаясь ответа сервера.
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
  /** Callback when a task is moved to a different column (optimistic — called immediately) */
  onMoveTask?: (taskId: string, newColumn: string) => void;
  /** Callback when a task card is tapped */
  onTaskTap?: (taskId: string) => void;
}

const COLUMN_ORDER: string[] = ['in_progress', 'review', 'backlog', 'done'];

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

  // Ref for tracking swipe direction (must be inside component to avoid SSR issues)
  const swipeDirectionRef = useRef<number>(1);

  // Оптимистичные перемещения: taskId -> { targetColumn, originalTask }
  const [swappedTasks, setSwappedTasks] = useState<Map<string, { targetColumn: string; originalTask: TaskEntity }>>(new Map());

  // Задачи, которые сейчас в exit-анимации: taskId -> fromColumn.
  // Нужно, чтобы карточка оставалась видимой в старой колонке, пока летит
  // за экран (300ms), даже если tasks.column уже мгновенно обновлён PATCH_TASK.
  const [pendingExit, setPendingExit] = useState<Map<string, string>>(new Map());

  // Сброс при закрытии шита — чтобы Map не копил устаревшие записи
  useEffect(() => {
    if (!open && (swappedTasks.size > 0 || pendingExit.size > 0)) {
      setSwappedTasks(new Map());
      setPendingExit(new Map());
    }
  }, [open, swappedTasks.size, pendingExit.size]);

  // Cleanup: как только задача подтверждена (task.column === targetColumn —
  // через realtime или оптимистичный PATCH_TASK), удаляем запись из Map.
  // Это держит Map ограниченным и не даёт originalTask замораживаться навсегда.
  useEffect(() => {
    if (swappedTasks.size === 0) return;
    setSwappedTasks((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [taskId, swapped] of prev) {
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.column === swapped.targetColumn) {
          next.delete(taskId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tasks, swappedTasks]);

  const handleMoveNext = useCallback(
    (taskId: string) => {
      if (!column) return;
      const currentIndex = COLUMN_ORDER.indexOf(column);
      if (currentIndex < 0 || currentIndex >= COLUMN_ORDER.length - 1) return;
      const nextColumn = COLUMN_ORDER[currentIndex + 1];
      swipeDirectionRef.current = 1;
      // Помечаем задачу как «уходящую» из этой колонки — она останется видимой
      // в stayedTasks, пока летит за экран (exit-анимация 300ms).
      setPendingExit((prev) => new Map(prev).set(taskId, column));
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
      swipeDirectionRef.current = -1;
      // Помечаем задачу как «уходящую» из этой колонки — она останется видимой
      // в stayedTasks, пока летит за экран (exit-анимация 300ms).
      setPendingExit((prev) => new Map(prev).set(taskId, column));
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

  // При свайпе: удаляем из текущей колонки, добавляем в новую
  const handleSwipeAway = useCallback(
    (taskId: string) => {
      if (!column) return;
      // Находим задачу в swappedTasks или в исходном списке
      const swapped = swappedTasks.get(taskId);
      const sourceTask = swapped?.originalTask ?? tasks.find((t) => t.id === taskId);
      if (!sourceTask) return;

      // Определяем целевую колонку по направлению свайпа
      const currentIndex = COLUMN_ORDER.indexOf(column);
      const direction = swipeDirectionRef.current;
      const targetColumn = direction > 0
        ? COLUMN_ORDER[Math.min(currentIndex + 1, COLUMN_ORDER.length - 1)]
        : COLUMN_ORDER[Math.max(currentIndex - 1, 0)];

      // Обновляем локальный state: задача теперь в новой колонке
      setSwappedTasks((prev) => {
        const next = new Map(prev);
        next.set(taskId, { targetColumn, originalTask: sourceTask });
        return next;
      });
      // Exit-анимация завершена — убираем из pendingExit
      setPendingExit((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Map(prev);
        next.delete(taskId);
        return next;
      });
    },
    [column, tasks, swappedTasks]
  );

  // Получаем задачи с учётом оптимистичных перемещений
  const displayTasks = (() => {
    // Задачи, которые были перемещены в эту колонку
    const incomingTasks = tasks.filter((t) => {
      const swapped = swappedTasks.get(t.id);
      return swapped && swapped.targetColumn === column;
    });

    // Задачи, которые остались в этой колонке (исключая те, что ушли)
    const stayedTasks = tasks.filter((t) => {
      const swapped = swappedTasks.get(t.id);
      // Исключаем задачи, которые были перемещены ОТсюда
      if (swapped && swapped.targetColumn !== column) return false;
      // Исключаем задачи, которые пришли из другой колонки (они уже в incoming)
      if (swapped && swapped.targetColumn === column) return false;
      // Задача в exit-анимации из этой колонки — держим её видимой, пока летит
      // за экран (даже если tasks.column уже обновлён PATCH_TASK).
      if (pendingExit.get(t.id) === column) return true;
      return t.column === column;
    });

    return [...incomingTasks, ...stayedTasks];
  })();

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
            {displayTasks.length}
          </span>
        </div>

        {/* List of tasks */}
        {displayTasks.length > 0 ? (
          <div className="flex w-full flex-col gap-2">
            {displayTasks.map((task) => {
              // Проверяем, была ли эта задача перемещена в эту колонку
              const wasSwapped = swappedTasks.has(task.id);
              const actualColumn = wasSwapped
                ? swappedTasks.get(task.id)?.targetColumn ?? task.column
                : task.column;

              return (
                <Suspense key={task.id} fallback={<div className="h-24 rounded bg-white/5" />}>
                  <SwipeableTaskCard
                    task={task}
                    columnOrder={COLUMN_ORDER}
                    currentColumn={actualColumn}
                    onMoveNext={handleMoveNext}
                    onMovePrev={handleMovePrev}
                    onTap={handleTap}
                    onSwipeAway={handleSwipeAway}
                  />
                </Suspense>
              );
            })}
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