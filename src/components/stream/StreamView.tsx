'use client';

import React, { useMemo, useState } from 'react';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { SectionHeader } from '@/components/ui/desk-ui/SectionHeader';
import { CognitiveWeightIndicator, PriorityBadge } from '@/components/flowboard/FlowBoard';
import { UrgencyBadge } from '@/components/flowboard/UrgencyBadge';
import type { TaskEntity } from '@/types/flowboard';

/**
 * StreamView — "Стрим задач" (Figma node 98:6093 "desks-stream").
 *
 * Layout (depth ≤ 5):
 *   - Header: layout-list icon + "Стрим задач" + current date
 *   - Cognitive weight summary (Нагрузка + indicator + status)
 *   - Focused tasks: grouped by column → task cards
 *   - Backlog sections: accordion header + expandable task list + "ЕЩЕ задачи"
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
}

// ─── Column grouping helpers ─────────────────────────────────────────────────

const COLUMN_ORDER = ['in_progress', 'review', 'backlog', 'done'] as const;
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
 */
function CollapsibleTaskGroup({ title, tasks, defaultOpen = true }: { title: string; tasks: TaskEntity[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  if (tasks.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        aria-label={open ? `Свернуть ${title}` : `Развернуть ${title}`}
      >
        <ChevronIcon open={open} />
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
          {tasks.length}
        </span>
      </button>
      {open && (
        <div className="flex w-full flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
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
}: StreamViewProps) {
  const grouped = useMemo(() => groupByColumn(tasks), [tasks]);

  const inProgressTasks = useMemo(() => grouped.get('in_progress') ?? [], [grouped]);
  const reviewTasks = useMemo(() => grouped.get('review') ?? [], [grouped]);
  const backlogTasks = useMemo(() => grouped.get('backlog') ?? [], [grouped]);
  const doneTasks = useMemo(() => grouped.get('done') ?? [], [grouped]);

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
      {inProgressTasks.length > 0 && (
        <div className="flex w-full flex-col gap-3">
          <SectionHeader title="В работе" />
          {inProgressTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Column: На проверке */}
      {reviewTasks.length > 0 && (
        <div className="flex w-full flex-col gap-3">
          <SectionHeader title="На проверке" />
          {reviewTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Column: В очереди */}
      {backlogTasks.length > 0 && (
        <CollapsibleTaskGroup title="В очереди" tasks={backlogTasks} defaultOpen={true} />
      )}

      {/* Column: Сделано */}
      {doneTasks.length > 0 && (
        <CollapsibleTaskGroup title="Сделано" tasks={doneTasks} defaultOpen={false} />
      )}

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