'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { SectionHeader } from '@/components/ui/desk-ui/SectionHeader';
import { CognitiveWeightIndicator, PriorityBadge } from '@/components/flowboard/FlowBoard';
import { UrgencyBadge } from '@/components/flowboard/UrgencyBadge';
import type { TaskEntity } from '@/types/flowboard';

// Lazy-load SwipeableTaskCard to avoid SSR serialization issues with useRef
const SwipeableTaskCard = lazy(() =>
  import('@/components/flowboard/SwipeableTaskCard').then((mod) => ({ default: mod.SwipeableTaskCard })),
);

/**
 * StreamView — "Стрим задач" (Figma node 98:6093 "desks-stream").
 *
 * Layout (depth ≤ 5):
 *   - Header: layout-list icon + "Стрим задач" + current date
 *   - Cognitive weight summary (Нагрузка + indicator + status)
 *   - Focused tasks: grouped by column → swipeable task cards
 *   - Backlog sections: accordion header + expandable task list + "ЕЩЕ задачи"
 *
 * Optimistic UI: при свайпе задачи она мгновенно перемещается между колонками
 * на клиенте (через swappedTasks), не дожидаясь ответа сервера.
 *
 * All values are relative (clamp / % / gap) for adaptive design.
 * Design tokens from src/styles/tokens.css + src/app/globals.css.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StreamViewProps {
  tasks: TaskEntity[];
  currentDate?: string;
  /** Cognitive load of the current user (0–3) */
  cognitiveWeight?: number;
  /** Status label for the cognitive weight row, e.g. "Свободен" */
  loadStatus?: string;
  loading?: boolean;
  error?: string | null;
  onRefresh?: (options?: { force?: boolean }) => void;
  /** Callback when a task is moved to a different column (optimistic — called immediately) */
  onMoveTask?: (taskId: string, newColumn: string) => void;
  /** Callback when a task card is tapped */
  onTaskTap?: (taskId: string) => void;
}

// ─── Column grouping helpers ─────────────────────────────────────────────────

export const COLUMN_ORDER: string[] = ['in_progress', 'review', 'backlog', 'done'];

const COLUMN_LABELS: Record<string, string> = {
  in_progress: 'В работе',
  review: 'На проверке',
  backlog: 'В очереди',
  done: 'Сделано',
};

function groupByColumn(tasks: TaskEntity[]): Map<string, TaskEntity[]> {
  const map = new Map<string, TaskEntity[]>();
  for (const t of tasks) {
    const col = t.column || 'backlog';
    const arr = map.get(col) ?? [];
    arr.push(t);
    map.set(col, arr);
  }
  return map;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function LayoutListIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="16" height="16" rx="2" fill="var(--color-text-primary)" />
      <rect x="4" y="4" width="3.5" height="12" rx="0.5" fill="var(--color-bg-primary-dark)" />
      <rect x="8.5" y="4" width="3.5" height="12" rx="0.5" fill="var(--color-bg-primary-dark)" />
      <rect x="13" y="4" width="3.5" height="12" rx="0.5" fill="var(--color-bg-primary-dark)" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform var(--transition-fast)',
        marginLeft: 'auto',
      }}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * TaskCard — single task in the stream.
 * Figma "task-card" (10:10763): padding 16px, gap 12px, radius 4, notch 16.
 */
export function TaskCard({ task }: { task: TaskEntity }) {
  const priorityColor =
    task.priority === 'critical' || task.priority === 'high'
      ? 'red'
      : task.priority === 'medium'
        ? 'amber'
        : 'green';

  const priorityLabel =
    task.priority === 'critical'
      ? 'Критично'
      : task.priority === 'high'
        ? 'Высокий'
        : task.priority === 'medium'
          ? 'Средний'
          : 'Низкий';

  return (
    <NotchedPanel
      corner="action"
      radius={4}
      notch={16}
      borderWidth={1}
      border="var(--color-line)"
      fill="var(--color-surface)"
      contentClassName="flex flex-col gap-3 p-4"
      aria-label={`Задача ${task.full_id}: ${task.title}`}
    >
      {/* main-info — title + priority */}
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              lineHeight: 'var(--text-body-md-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
            }}
          >
            {task.title}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-xs)',
              lineHeight: 'var(--text-body-xs-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {task.full_id}
          </span>
        </div>
        <PriorityBadge label={priorityLabel} color={priorityColor as 'red' | 'amber' | 'green'} />
      </div>

      {/* prop-list — tags + urgency */}
      {(task.tags.length > 0 || task.deadline) && (
        <div className="flex w-full flex-wrap items-center gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded px-1.5 py-0.5"
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-xs)',
                lineHeight: 'var(--text-body-xs-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-muted)',
                backgroundColor: 'var(--color-bg-surface-hover)',
              }}
            >
              {tag}
            </span>
          ))}
          {task.deadline && <UrgencyBadge deadline={task.deadline} size="sm" />}
        </div>
      )}

      {/* footer — assignee + blocked/human flags */}
      <div className="flex w-full items-center justify-between gap-2">
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-xs)',
            lineHeight: 'var(--text-body-xs-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
          }}
        >
          {task.assigned_to || 'Не назначено'}
        </span>
        <div className="flex items-center gap-1">
          {task.is_blocked && (
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-xs)',
                lineHeight: 'var(--text-body-xs-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-signal-red)',
                backgroundColor: 'var(--color-priority-red-bg)',
              }}
            >
              Заблокировано
            </span>
          )}
          {task.needs_human && (
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-xs)',
                lineHeight: 'var(--text-body-xs-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-signal-cyan)',
                backgroundColor: 'var(--color-priority-cyan-bg)',
              }}
            >
              Нужен человек
            </span>
          )}
        </div>
      </div>
    </NotchedPanel>
  );
}

/**
 * CollapsibleTaskGroup — section with amber accent line + title + task list.
 * Supports collapse/expand with chevron arrow.
 * Integrates SwipeableTaskCard with optimistic UI state from parent.
 */
function CollapsibleTaskGroup({
  title,
  tasks,
  defaultOpen = true,
  columnKey,
  swappedTasks,
  pendingExit,
  handleMoveNext,
  handleMovePrev,
  handleTap,
  handleSwipeAway,
}: {
  title: string;
  tasks: TaskEntity[];
  defaultOpen?: boolean;
  columnKey: string;
  swappedTasks: Map<string, { targetColumn: string; originalTask: TaskEntity }>;
  pendingExit: Map<string, string>;
  handleMoveNext: (taskId: string) => void;
  handleMovePrev: (taskId: string) => void;
  handleTap: (taskId: string) => void;
  handleSwipeAway: (taskId: string) => void;
}) {
  // Cast COLUMN_ORDER to string[] for SwipeableTaskCard compatibility
  const cardColumnOrder: string[] = COLUMN_ORDER;
  const [open, setOpen] = useState(defaultOpen);

  if (tasks.length === 0) return null;

  // Compute display tasks with optimistic moves
  const incomingTasks = tasks.filter((t) => {
    const swapped = swappedTasks.get(t.id);
    return swapped && swapped.targetColumn === columnKey;
  });

  const stayedTasks = tasks.filter((t) => {
    const swapped = swappedTasks.get(t.id);
    if (swapped && swapped.targetColumn !== columnKey) return false;
    if (swapped && swapped.targetColumn === columnKey) return false;
    if (pendingExit.get(t.id) === columnKey) return true;
    return t.column === columnKey;
  });

  const displayTasks = [...incomingTasks, ...stayedTasks];

  return (
    <div className="flex w-full flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
        aria-label={open ? `Свернуть ${title}` : `Развернуть ${title}`}
      >
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-full"
            style={{
              width: 'var(--size-accent-line-width)',
              height: 'var(--size-accent-line-height)',
              backgroundColor: 'var(--color-accent-amber)',
            }}
            aria-hidden="true"
          />
          <h3
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: '17px',
              lineHeight: '22px',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {title}
          </h3>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: '17px',
              lineHeight: '22px',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {displayTasks.length}
          </span>
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="flex w-full flex-col gap-3">
          {displayTasks.map((task) => {
            const wasSwapped = swappedTasks.has(task.id);
            const actualColumn = wasSwapped
              ? swappedTasks.get(task.id)?.targetColumn ?? task.column
              : task.column;

            return (
              <Suspense key={task.id} fallback={<div className="h-24 rounded bg-white/5" />}>
                <SwipeableTaskCard
                  task={task}
                  columnOrder={cardColumnOrder}
                  currentColumn={actualColumn as typeof cardColumnOrder[number]}
                  onMoveNext={handleMoveNext}
                  onMovePrev={handleMovePrev}
                  onTap={handleTap}
                  onSwipeAway={handleSwipeAway}
                />
              </Suspense>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function StreamView({
  tasks,
  currentDate = 'Четверг, 20 мая',
  cognitiveWeight = 0,
  loadStatus = 'Свободен',
  loading = false,
  error,
  onRefresh,
  onMoveTask,
  onTaskTap,
}: StreamViewProps) {
  const grouped = useMemo(() => groupByColumn(tasks), [tasks]);

  const inProgressTasks = useMemo(() => grouped.get('in_progress') ?? [], [grouped]);
  const reviewTasks = useMemo(() => grouped.get('review') ?? [], [grouped]);
  const backlogTasks = useMemo(() => grouped.get('backlog') ?? [], [grouped]);
  const doneTasks = useMemo(() => grouped.get('done') ?? [], [grouped]);

  // Ref for tracking swipe direction (must be inside component to avoid SSR issues)
  const swipeDirectionRef = useRef<number>(1);

  // Оптимистичные перемещения: taskId -> { targetColumn, originalTask }
  const [swappedTasks, setSwappedTasks] = useState<Map<string, { targetColumn: string; originalTask: TaskEntity }>>(new Map());

  // Задачи, которые сейчас в exit-анимации: taskId -> fromColumn.
  // Нужно, чтобы карточка оставалась видимой в старой колонке, пока летит
  // за экран (300ms), даже если tasks.column уже мгновенно обновлён PATCH_TASK.
  const [pendingExit, setPendingExit] = useState<Map<string, string>>(new Map());

  // Cleanup swappedTasks: как только задача подтверждена (task.column === targetColumn —
  // через realtime или оптимистичный PATCH_TASK), удаляем запись из Map.
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
      const task = tasks.find((t) => t.id === taskId);
      if (!task || !task.column) return;
      const currentIndex = COLUMN_ORDER.indexOf(task.column);
      if (currentIndex < 0 || currentIndex >= COLUMN_ORDER.length - 1) return;
      const nextColumn = COLUMN_ORDER[currentIndex + 1];
      swipeDirectionRef.current = 1;
      // Удерживаем задачу в старой колонке через swappedTasks — groupByColumn
      // уже переместил задачу в новую колонку оптимистично, но stayedTasks
      // исключит её (swapped.targetColumn !== columnKey), а pendingExit
      // удержит видимой в старой колонке во время exit-анимации.
      setSwappedTasks((prev) => new Map(prev).set(taskId, { targetColumn: nextColumn, originalTask: task }));
      setPendingExit((prev) => new Map(prev).set(taskId, task.column));
      onMoveTask?.(taskId, nextColumn);
    },
    [tasks, onMoveTask]
  );

  const handleMovePrev = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || !task.column) return;
      const currentIndex = COLUMN_ORDER.indexOf(task.column);
      if (currentIndex <= 0) return;
      const prevColumn = COLUMN_ORDER[currentIndex - 1];
      swipeDirectionRef.current = -1;
      setSwappedTasks((prev) => new Map(prev).set(taskId, { targetColumn: prevColumn, originalTask: task }));
      setPendingExit((prev) => new Map(prev).set(taskId, task.column));
      onMoveTask?.(taskId, prevColumn);
    },
    [tasks, onMoveTask]
  );

  const handleTap = useCallback(
    (taskId: string) => {
      onTaskTap?.(taskId);
    },
    [onTaskTap]
  );

  const handleSwipeAway = useCallback((taskId: string) => {
    // Оптимистичный PATCH_TASK уже обновил task.column на сервере и в локальном state.
    // Задача автоматически появилась в новой колонке через groupByColumn.
    // pendingExit удерживал её в старой колонке во время exit-анимации.
    // Когда анимация завершена — просто убираем из pendingExit, чтобы задача
    // отобразилась в новой колонке (где она уже есть благодаря оптимистичному обновлению).
    // swappedTasks НЕ используем — он нужен только для "incoming" задач из других колонок,
    // но в StreamView задачи перемещаются через обновление task.column, а не через swapped.
    setPendingExit((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh"
        style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}
      >
        <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full min-h-dvh px-4"
        style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}
      >
        <div
          className="flex flex-col items-center gap-4 p-6 rounded max-w-md w-full"
          style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-flowboard-section)' }}
          role="alert"
        >
          <span style={{ fontSize: 'var(--text-body-xl)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-error)' }}>⚠️</span>
          <p style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-md)', color: 'var(--color-text-primary)', textAlign: 'center' as const }}>
            Произошла ошибка при загрузке данных
          </p>
          <p style={{ fontFamily: 'var(--font-family-base)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)', textAlign: 'center' as const }}>
            {error}
          </p>
          {onRefresh && (
            <button
              onClick={() => onRefresh({ force: true })}
              className="flex items-center justify-center h-10 px-6 rounded transition-colors hover:bg-surface/50"
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-md)',
                lineHeight: 'var(--text-body-md-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'var(--color-accent-amber)',
                border: 'none',
              }}
            >
              Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full mx-auto px-4 bg-primary-dark h-full"
      style={{
        backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))',
        maxWidth: '100%',
        margin: '0 auto',
        gap: 'var(--spacing-6)',
        minHeight: 'var(--tg-viewport-stable-height, 100dvh)',
        paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
      }}
      aria-label="Стрим задач"
    >
      {/* Header row — icon + title + date */}
      <div className="flex w-full shrink-0" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--spacing-2)' }}>
        <div className="flex items-center gap-2">
          <LayoutListIcon />
          <h1
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'clamp(20px, 3vw, 24px)',
              lineHeight: '24px',
              fontWeight: 'var(--font-weight-medium)',
              letterSpacing: '-0.025em',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Стрим задач
          </h1>
        </div>
        <p
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
            margin: 0,
          }}
        >
          {currentDate}
        </p>
      </div>

      {/* Cognitive weight summary — Figma "cognitive-weight-container" */}
      <NotchedPanel
        corner="action"
        radius={4}
        notch={8}
        borderWidth={1}
        border="var(--color-line)"
        fill="var(--color-surface)"
        contentClassName="flex w-full items-center justify-between gap-2 p-3"
        aria-label="Нагрузка"
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              lineHeight: 'var(--text-body-md-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
            }}
          >
            Нагрузка
          </span>
          <CognitiveWeightIndicator weight={cognitiveWeight} />
        </div>
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: 'var(--text-body-sm-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
          }}
        >
          {loadStatus}
        </span>
      </NotchedPanel>

      {/* Column: В работе */}
      <CollapsibleTaskGroup
        title="В работе"
        tasks={inProgressTasks}
        defaultOpen={true}
        columnKey="in_progress"
        swappedTasks={swappedTasks}
        pendingExit={pendingExit}
        handleMoveNext={handleMoveNext}
        handleMovePrev={handleMovePrev}
        handleTap={handleTap}
        handleSwipeAway={handleSwipeAway}
      />

      {/* Column: На проверке */}
      <CollapsibleTaskGroup
        title="На проверке"
        tasks={reviewTasks}
        defaultOpen={true}
        columnKey="review"
        swappedTasks={swappedTasks}
        pendingExit={pendingExit}
        handleMoveNext={handleMoveNext}
        handleMovePrev={handleMovePrev}
        handleTap={handleTap}
        handleSwipeAway={handleSwipeAway}
      />

      {/* Column: В очереди */}
      <CollapsibleTaskGroup
        title="В очереди"
        tasks={backlogTasks}
        defaultOpen={true}
        columnKey="backlog"
        swappedTasks={swappedTasks}
        pendingExit={pendingExit}
        handleMoveNext={handleMoveNext}
        handleMovePrev={handleMovePrev}
        handleTap={handleTap}
        handleSwipeAway={handleSwipeAway}
      />

      {/* Column: Сделано */}
      <CollapsibleTaskGroup
        title="Сделано"
        tasks={doneTasks}
        defaultOpen={false}
        columnKey="done"
        swappedTasks={swappedTasks}
        pendingExit={pendingExit}
        handleMoveNext={handleMoveNext}
        handleMovePrev={handleMovePrev}
        handleTap={handleTap}
        handleSwipeAway={handleSwipeAway}
      />

      {/* Empty state */}
      {tasks.length === 0 && (
        <div className="flex w-full flex-col items-center justify-center gap-2 py-16">
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              lineHeight: 'var(--text-body-md-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
            }}
          >
            Задач пока нет
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
            Создайте первую задачу через кнопку «+»
          </span>
        </div>
      )}

      {/* Bottom spacer */}
      <div
        className="h-16 xs:h-20 w-full shrink-0"
        style={{ backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))' }}
        aria-hidden="true"
      />
    </div>
  );
}