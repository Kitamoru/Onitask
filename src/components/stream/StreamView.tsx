'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { CognitiveWeightIndicator, PriorityBadge } from '@/components/flowboard/FlowBoard';
import { UrgencyBadge } from '@/components/flowboard/UrgencyBadge';
import type { TaskEntity } from '@/types/flowboard';

// ─── Avatar placeholder helper ────────────────────────────────────────────────
// Square avatar: gray border, dark bg, first letter of worker display name
// Matches ParticipantCard pattern: displayName.charAt(0).toUpperCase()
function AvatarPlaceholder({ workerName, size = '1.5rem' }: { workerName: string | null | undefined; size?: string }) {
  if (!workerName) {
    // Empty avatar: square with gray border and dark background
    return (
      <div
        className="shrink-0 overflow-hidden"
        style={{
          width: size,
          height: size,
          border: '1px solid var(--color-line)',
          backgroundColor: 'var(--color-bg-primary-dark)',
        }}
        aria-hidden="true"
      />
    );
  }
  // First letter of display name (same as ParticipantCard)
  const initial = workerName.charAt(0).toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        border: '1px solid var(--color-line)',
        backgroundColor: 'var(--color-bg-primary-dark)',
        fontSize: `calc(${size} * 0.4)`,
        fontWeight: 500,
        color: 'var(--color-text-muted)',
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

// ─── Arrow icon ───────────────────────────────────────────────────────────────
function ArrowRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 3L11 8L6 13"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * StreamView — "Стрим задач" (Figma node 98:6093 "desks-stream").
 *
 * Layout (depth ≤ 5):
 *   - Header: layout-list icon + "Стрим задач" + current date
 *   - Cognitive weight summary (Нагрузка + indicator + status)
 *   - Focused tasks: grouped by column → task cards (accordion)
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
  /** Toggle between flowboard and stream views */
  onToggleView?: () => void;
}

// ─── Column grouping helpers ─────────────────────────────────────────────────

export const COLUMN_ORDER: string[] = ['backlog', 'in_progress', 'review', 'done'];

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

/**
 * TaskCard — single task in the stream.
 * Figma "task-card" (node 240-27222): padding 16px, gap 12px, radius 4, notch 16.
 *
 * Layout:
 *   1. main-info (row, gap 6px): [Title] [cognitive_weight badge] — same line
 *   2. prop-list (row, wrap, gap 4px): [priority badge] [workspace badge] [tags] [urgency badge]
 *   3. footer (row, space-between):
 *      - Left: [avatar created_by] → [arrow] → [avatar assigned_to]
 *      - Right: "до ДД ММ • WORKSPACE-NUM"
 *   4. svetofor-accent-light SVG decoration (bottom)
 *   5. ref-bg-shape-inner SVG decoration (bottom)
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

  // Format deadline for display: "до Вт 27 мая"
  const formattedDeadline = task.deadline
    ? (() => {
        const d = new Date(task.deadline);
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const months = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];
        const dayName = days[d.getDay()];
        const day = d.getDate();
        const month = months[d.getMonth()];
        return `до ${dayName} ${day} ${month}`;
      })()
    : null;

  // Workspace display name (or fallback to prefix)
  const workspaceDisplayName = task.workspace_name ?? task.workspace_prefix;

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
      {/* 1. main-info — title + cognitive weight badge on same line (gap 6px) */}
      <div className="flex w-full items-start justify-between gap-[6px]">
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
            flex: '1 1 0',
            minWidth: 0,
          }}
          className="truncate"
        >
          {task.title}
        </span>
        {/* Cognitive weight — 3 squares for counting (filled = amber, empty = gray border) */}
        {task.cognitive_weight > 0 && (
          <div className="flex shrink-0 items-center gap-[3px]" aria-label={`Cognitive weight: ${task.cognitive_weight}`}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="shrink-0"
                style={{
                  width: '0.625rem',   // 10px → relative
                  height: '0.625rem',  // 10px → relative
                  backgroundColor: i <= task.cognitive_weight
                    ? 'var(--color-accent-amber)'
                    : 'transparent',
                  border: i <= task.cognitive_weight
                    ? 'none'
                    : '1px solid var(--color-line)',
                  borderRadius: '1px',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 2. prop-list — badges row (wrap, gap 4px) */}
      <div className="flex w-full flex-wrap items-center gap-1">
        {/* Priority badge */}
        <PriorityBadge label={priorityLabel} color={priorityColor as 'red' | 'amber' | 'green'} />

        {/* Workspace name badge — matches PriorityBadge style with border */}
        {workspaceDisplayName && (
          <span
            className="rounded px-1 py-0.5"
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-bg-surface-hover)',
              border: '1px solid var(--color-text-muted)',
              borderRadius: 'var(--radius-flowboard-section)',
            }}
          >
            {workspaceDisplayName}
          </span>
        )}

        {/* Tags — matches PriorityBadge style with border */}
        {(task.tags ?? []).slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded px-1 py-0.5"
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-bg-surface-hover)',
              border: '1px solid var(--color-text-muted)',
              borderRadius: 'var(--radius-flowboard-section)',
            }}
          >
            {tag}
          </span>
        ))}

        {/* Urgency badge */}
        {task.deadline && <UrgencyBadge deadline={task.deadline} size="sm" />}
      </div>

      {/* 3. footer — avatars left, deadline right (space-between) */}
      <div className="flex w-full items-center justify-between gap-2">
        {/* Left: avatar created_by → arrow → avatar assigned_to */}
        <div className="flex items-center gap-1">
          <AvatarPlaceholder workerName={task.created_by_name} size="1.5rem" />
          <ArrowRightIcon size={16} />
          <AvatarPlaceholder workerName={task.assigned_to_name} size="1.5rem" />
        </div>

        {/* Right: deadline + task number */}
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-xs)',
            lineHeight: 'var(--text-body-xs-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {formattedDeadline} • {task.full_id}
        </span>
      </div>

    </NotchedPanel>
  );
}

/**
 * AccordionSection — collapsible column header with amber line, label, count, chevron.
 * Layout: [amber line] [label 17px] [count 17px] ... [chevron 17×17]
 */
function AccordionSection({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer select-none items-center gap-2 py-1 transition-opacity hover:opacity-80 active:opacity-60"
        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
        aria-expanded={open}
        aria-label={`${label}: ${count} задач${count === 1 ? 'а' : count < 5 ? 'и' : ''}. ${open ? 'Свернуть' : 'Развернуть'}`}
      >
        {/* Amber accent line — 3px wide */}
        <div
          className="shrink-0"
          style={{
            width: '3px',
            height: '17px',
            borderRadius: '1.5px',
            backgroundColor: 'var(--color-accent-amber)',
          }}
          aria-hidden="true"
        />
        {/* Label */}
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: '17px',
            lineHeight: '22px',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          {label}
        </span>
        {/* Count */}
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: '17px',
            lineHeight: '22px',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
            margin: 0,
          }}
        >
          {count}
        </span>
        {/* Spacer */}
        <div className="flex-1" />
        {/* Chevron — rightmost, 17×17 */}
        <IconChevronDown
          size={17}
          stroke={1.5}
          className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          style={{ color: 'var(--color-text-muted)' }}
          aria-hidden="true"
        />
      </button>
      {/* Tasks list — visible only when expanded */}
      {open && (
        <div className="flex w-full flex-col gap-3">
          {children}
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
  onToggleView,
}: StreamViewProps) {
  const grouped = useMemo(() => groupByColumn(tasks), [tasks]);

  const inProgressTasks = useMemo(() => grouped.get('in_progress') ?? [], [grouped]);
  const reviewTasks = useMemo(() => grouped.get('review') ?? [], [grouped]);
  const backlogTasks = useMemo(() => grouped.get('backlog') ?? [], [grouped]);
  const doneTasks = useMemo(() => grouped.get('done') ?? [], [grouped]);

  // Accordion state: all columns expanded by default, "done" collapsed
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({
    backlog: true,
    in_progress: true,
    review: true,
    done: false,
  });

  const toggleColumn = useCallback((key: string) => {
    setExpandedColumns((prev) => ({ ...prev, [key]: !prev[key] }));
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
      {/* Header row — icon + clickable title + date */}
      <div className="flex w-full shrink-0" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--spacing-2)' }}>
        <div
          className="flex cursor-pointer select-none items-center gap-2 transition-opacity hover:opacity-80 active:opacity-60"
          onClick={onToggleView}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleView?.(); } }}
          role="button"
          tabIndex={0}
          aria-label="Переключить на флоу задач"
        >
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

      {/* Columns — accordion sections */}
      <AccordionSection
        label={COLUMN_LABELS.in_progress}
        count={inProgressTasks.length}
        open={!!expandedColumns.in_progress}
        onToggle={() => toggleColumn('in_progress')}
      >
        {inProgressTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </AccordionSection>

      <AccordionSection
        label={COLUMN_LABELS.backlog}
        count={backlogTasks.length}
        open={!!expandedColumns.backlog}
        onToggle={() => toggleColumn('backlog')}
      >
        {backlogTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </AccordionSection>

      <AccordionSection
        label={COLUMN_LABELS.review}
        count={reviewTasks.length}
        open={!!expandedColumns.review}
        onToggle={() => toggleColumn('review')}
      >
        {reviewTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </AccordionSection>

      <AccordionSection
        label={COLUMN_LABELS.done}
        count={doneTasks.length}
        open={!!expandedColumns.done}
        onToggle={() => toggleColumn('done')}
      >
        {doneTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </AccordionSection>

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