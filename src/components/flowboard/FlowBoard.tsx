'use client';

import React, { useState, useCallback } from 'react';
import { SectionHeader as DeskSectionHeader, Button } from '@/components/ui/desk-ui';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { SprintCard } from '@/components/sprint/SprintCard';
import { SprintCreateSheet } from '@/components/sprint/SprintCreateSheet';
import { SprintEditSheet } from '@/components/sprint/SprintEditSheet';
import { SprintViewSheet } from '@/components/sprint/SprintViewSheet';
import type { SprintFormValue, SprintStats } from '@/components/sprint/types';
import { formatDateRange, computeDaysLeft, toISODate } from '@/lib/date';

/**
 * FlowBoard component — displays the flow task overview page.
 *
 * Figma spec (node 1:445 "desk-flow"):
 *   - Main frame: column, gap=24px, padding=16px, bg=#0A0A0A, maxWidth=390px
 *   - Header: kanban icon + "Флоу задач" + date subtitle
 *   - Sprint compressed info: sprint name + priority badge + progress bar + statistics
 *   - Signals: 3-column grid (People, Processes, Escalations)
 *   - Task statuses: 2x2 grid with progress bars
 *   - Team members section: worker cards with cognitive weight + "Добавить коллегу" button
 *   - Agents section: agent cards + "Добавить Агента" button
 *   - Bottom filler: 80px
 *
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 * Design system: SectionHeader and Button from desk-ui
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SprintInfo {
  id: string;
  name: string;
  topic: string;
  startDate: string;
  endDate: string;
  daysElapsed: number;
  totalDays: number;
  progress: number;
  doneSP: number;
  totalSP: number;
  inProgress: number;
  onReview: number;
  isActive: boolean;
  /** Sprint status: 'planning' | 'active' | 'completed' */
  status?: string;
  /** Sprint capacity in story points */
  capacity?: string | null;
  /** Number of completed tasks in this sprint */
  doneTasks?: number;
}

export interface SignalData {
  id: string;
  label: string;
  count: number;
  description?: string;
}

export interface TaskStatusData {
  id: string;
  label: string;
  count: number;
  shapes: number;
  maxShapes: number;
  color: string;
}

export interface WorkerCardData {
  id: string;
  displayName: string;
  avatarUrl?: string;
  cognitiveWeight: number;
  spPerDay: number;
  trendUp: boolean;
  activeDays: number;
  roleLabel: string;
  overloaded?: boolean;
  tasks: string[];
}

export interface AgentCardData {
  id: string;
  name: string;
  cognitiveWeight: number;
  spPerDay: number;
  trendUp: boolean;
  activeDays: number;
  roleLabel: string;
  overloaded?: boolean;
  tasks: string[];
}

export interface FlowBoardProps {
  title?: string;
  currentDate?: string;
  /** Whether sprints are enabled for this workspace */
  sprintEnabled?: boolean;
  sprint?: SprintInfo;
  signals: SignalData[];
  taskStatuses: TaskStatusData[];
  workers: WorkerCardData[];
  agents: AgentCardData[];
  loading?: boolean;
  error?: string | null;
  onAddWorker?: () => void;
  onAddAgent?: () => void;
  onRefresh?: (options?: { force?: boolean }) => void;
  /** Show onboarding modal for new users (no workspace) */
  isNewUser?: boolean;
  /** Callback when board is created successfully */
  onBoardCreate?: () => void;
  /** Telegram WebApp initData string for API authentication */
  initData?: string;
  /** Current workspace ID — used to create sprints in the correct workspace */
  workspaceId?: string;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KanbanIcon() {
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
      <rect x="8.5" y="4" width="3.5" height="8" rx="0.5" fill="var(--color-bg-primary-dark)" />
      <rect x="13" y="4" width="3.5" height="10" rx="0.5" fill="var(--color-bg-primary-dark)" />
    </svg>
  );
}

export function PriorityBadge({ label, color = 'green' }: { label: string; color?: 'green' | 'amber' | 'red' | 'cyan' }) {
  const colorMap = {
    green: { bg: 'var(--color-priority-green-bg)', text: 'var(--color-priority-green-text)', border: 'var(--color-priority-green-border)' },
    amber: { bg: 'var(--color-priority-amber-bg)', text: 'var(--color-priority-amber-text)', border: 'var(--color-priority-amber-border)' },
    red: { bg: 'var(--color-priority-red-bg)', text: 'var(--color-priority-red-text)', border: 'var(--color-priority-red-border)' },
    cyan: { bg: 'var(--color-priority-cyan-bg)', text: 'var(--color-priority-cyan-text)', border: 'var(--color-priority-cyan-border)' },
  };
  const c = colorMap[color];
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 rounded"
      style={{ backgroundColor: c.bg, border: `1px solid ${c.border}`, borderRadius: 'var(--radius-flowboard-section)' }}
      aria-label={`Приоритет: ${label}`}
    >
      {/* Rhombus marker — matches task-shape-rhombus.svg, colored like the label text */}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
        <path
          d="M4.58579 2.91421C5.36684 2.13316 6.63316 2.13317 7.41421 2.91421L9.08579 4.58579C9.86684 5.36684 9.86683 6.63316 9.08579 7.41421L7.41421 9.08579C6.63316 9.86684 5.36683 9.86683 4.58579 9.08579L2.91421 7.41421C2.13316 6.63316 2.13317 5.36683 2.91421 4.58579L4.58579 2.91421Z"
          fill={c.text}
        />
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: c.text,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div
      className="w-full relative overflow-hidden"
      style={{ height: '8px', borderRadius: 'var(--radius-flowboard-section)' }}
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Прогресс спринта: ${progress}%`}
    >
      {/* Track — matches Figma progress-bar-track.svg (#8B8B8B @ 20% opacity) */}
      <svg viewBox="0 0 334 8" preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
        <rect y="2" width="334" height="4" rx="1" fill="#8B8B8B" opacity="0.2" />
      </svg>
      {/* Fill — green #4ADE80 per Figma */}
      <div
        className="absolute top-0 left-0 h-full"
        style={{ width: `${progress}%`, backgroundColor: '#4ADE80', borderRadius: 'var(--radius-flowboard-section)' }}
      />
    </div>
  );
}

/**
 * SprintCompressedInfo — displays sprint progress bar and statistics.
 * When no sprint data is available, renders a placeholder inviting the user
 * to create their first sprint.
 */
export function SprintCompressedInfo({ sprint }: { sprint?: SprintInfo }) {
  // Placeholder shown when sprint data is missing (first launch scenario)
  if (!sprint) {
    return (
      <NotchedPanel
        corner="action"
        radius={4}
        notch={8}
        borderWidth={1}
        border="var(--color-line)"
        fill="var(--color-surface)"
        contentClassName="flex flex-col items-center justify-center gap-2 p-6"
        aria-label="Спринт не создан"
      >
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
            textAlign: 'center' as const,
          }}
        >
          Спринт не создан
        </span>
        <span
          style={{
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: 'var(--text-body-sm-line)',
            fontWeight: 'var(--font-weight-normal)',
            color: 'var(--color-text-muted)',
            textAlign: 'center' as const,
          }}
        >
          Нажмите на карточку, чтобы создать первый спринт
        </span>
      </NotchedPanel>
    );
  }

  // Progress is computed from completed tasks vs capacity in the sprint
  const capacityNum = parseInt(sprint.capacity ?? '0', 10) || 0;
  const doneTasks = sprint.doneTasks ?? 0;
  const progressPercent =
    capacityNum > 0 ? Math.round((doneTasks / capacityNum) * 100) : 0;

  // Short date format: "19-28 мая"
  const shortDateRange = (() => {
    if (!sprint.startDate || !sprint.endDate) return '';
    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);
    const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${start.getDate()} ${monthNames[start.getMonth()]} – ${end.getDate()} ${monthNames[end.getMonth()]}`;
  })();

  return (
    <NotchedPanel
      corner="action"
      radius={4}
      notch={8}
      borderWidth={1}
      border="var(--color-line)"
      fill="var(--color-surface)"
      contentClassName="relative flex flex-col w-full p-3"
      aria-label="Информация о спринте"
    >
      {/* Row 1: Sprint name */}
      <div className="flex items-center justify-between w-full">
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-lg)',
            lineHeight: 'var(--text-body-lg-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          {sprint.name}
        </span>
        <PriorityBadge label={sprint.isActive ? 'Активный' : 'Запланирован'} color={sprint.isActive ? 'green' : 'amber'} />
      </div>

      {/* Row 2: Sprint goal/topic */}
      {sprint.topic && (
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: 'var(--text-body-sm-line)',
            fontWeight: 'var(--font-weight-normal)',
            color: 'var(--color-text-muted)',
          }}
        >
          {sprint.topic}
        </span>
      )}

      {/* Row 3: Short date range + days elapsed/total */}
      {shortDateRange && (
        <div className="flex items-center gap-1">
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {shortDateRange}
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>•</span>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {sprint.daysElapsed}/{sprint.totalDays} дней
          </span>
        </div>
      )}

      <div className="relative w-full mt-2">
        <ProgressBar progress={progressPercent} />
      </div>

      {/* Divider */}
      <svg viewBox="0 0 358 1" preserveAspectRatio="none" className="relative w-full h-px mt-2" aria-hidden="true">
        <rect width="358" height="1" fill="#FFFFFF" fillOpacity="0.2" />
      </svg>

      {/* Stats row: Готово: doneTasks/capacity (both numbers gray) */}
      <div className="relative flex items-center gap-1 mt-2" aria-label="Статистика спринта">
        <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>Готово:</span>
        <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>{doneTasks}</span>
        <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>/ {capacityNum || '-'}</span>
      </div>
    </NotchedPanel>
  );
}

function SignalCard({ signal }: { signal: SignalData }) {
  return (
    <NotchedPanel
      corner="action"
      radius={4}
      notch={8}
      borderWidth={1}
      border="var(--color-line)"
      fill="var(--color-surface)"
      contentClassName="flex flex-col gap-2 p-3"
    >
      <span
        style={{
          fontFamily: 'Inter Display, system-ui, sans-serif',
          fontSize: '16px',
          lineHeight: '20px',
          fontWeight: 500,
          color: signal.count <= 3 ? 'var(--color-signal-green)' : '#FAFAFA',
        }}
      >
        {signal.count}
      </span>
      <div className="flex flex-col gap-0.5">
        <span
          style={{
            fontFamily: 'Inter Display, system-ui, sans-serif',
            fontSize: '12px',
            lineHeight: '14px',
            fontWeight: 500,
            color: '#8B8B8B',
          }}
        >
          {signal.label}
        </span>
        <span
          style={{
            fontFamily: 'Inter Display, system-ui, sans-serif',
            fontSize: '12px',
            lineHeight: '14px',
            fontWeight: 500,
            color: '#8B8B8B',
          }}
        >
          {signal.description}
        </span>
      </div>
    </NotchedPanel>
  );
}

function TaskStatusCard({ status }: { status: TaskStatusData }) {
  return (
    <NotchedPanel
      corner="action"
      radius={4}
      notch={8}
      borderWidth={1}
      border="var(--color-line)"
      fill="var(--color-surface)"
      contentClassName="flex flex-col gap-2 p-3"
    >
      <div className="flex items-center gap-1">
        <div
          className="shrink-0"
          style={{ width: '12px', height: '9px', borderRadius: '2px', backgroundColor: status.color }}
          aria-hidden="true"
        />
        <span
          style={{
            fontFamily: 'Inter Display, system-ui, sans-serif',
            fontSize: '12px',
            lineHeight: '14px',
            fontWeight: 500,
            color: '#8B8B8B',
            flex: 1,
          }}
        >
          {status.label}
        </span>
        <span
          style={{
            fontFamily: 'Inter Display, system-ui, sans-serif',
            fontSize: '16px',
            lineHeight: '20px',
            fontWeight: 500,
            color: '#FAFAFA',
          }}
        >
          {status.count}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: status.maxShapes }).map((_, idx) => (
          <div
            key={idx}
            className="shrink-0"
            style={{
              width: '10px',
              height: '7px',
              borderRadius: '2px',
              backgroundColor: idx < status.shapes ? status.color : 'var(--color-border-white-subtle)',
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    </NotchedPanel>
  );
}

export function CognitiveWeightIndicator({ weight }: { weight: number }) {
  const maxWeight = 3;
  return (
    <div className="flex items-center gap-0.5" aria-label={`Вес когнитивной нагрузки: ${weight}`}>
      {Array.from({ length: maxWeight }).map((_, idx) => (
        <div
          key={idx}
          style={{
            width: '12px',
            height: '9px',
            borderRadius: '1.5px',
            backgroundColor: idx < weight ? 'var(--color-accent-amber)' : 'transparent',
            border: idx < weight ? 'none' : `1.5px solid var(--color-text-secondary)`,
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function UserAvatar({ displayName, avatarUrl, size = 'md' }: { displayName: string; avatarUrl?: string; size?: 'sm' | 'md' }) {
  const sizeMap = { sm: '24px', md: '36px' };
  const sizePx = sizeMap[size];
  return (
    <div className="relative shrink-0 overflow-hidden rounded" style={{ width: sizePx, height: sizePx, borderRadius: '1.6px' }}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="object-cover w-full h-full" aria-hidden="true" />
      ) : (
        <div className="flex items-center justify-center w-full h-full" style={{ backgroundColor: 'var(--color-bg-surface-hover)' }}>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}

export function PersonCard({ person, type = 'worker' }: { person: WorkerCardData | AgentCardData; type?: 'worker' | 'agent' }) {
  const displayName = 'displayName' in person ? person.displayName : person.name;
  const avatarUrl = 'avatarUrl' in person ? person.avatarUrl : undefined;
  const cognitiveWeight = person.cognitiveWeight;
  const spPerDay = person.spPerDay;
  const trendUp = person.trendUp;
  const activeDays = person.activeDays;
  const roleLabel = person.roleLabel;
  const overloaded = person.overloaded;
  const tasks = person.tasks;

  return (
    <NotchedPanel
      corner="action"
      radius={4}
      notch={8}
      borderWidth={1}
      border="var(--color-line)"
      fill="var(--color-surface)"
      contentClassName="flex flex-col gap-2 p-3"
      aria-label={`${displayName}${roleLabel ? `, ${roleLabel}` : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <UserAvatar displayName={displayName} avatarUrl={avatarUrl} />
          <CognitiveWeightIndicator weight={cognitiveWeight} />
        </div>
        <div className="flex flex-col flex-1 gap-1">
          <div className="flex items-center justify-between">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-md)',
                lineHeight: 'var(--text-body-md-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              {displayName}
            </span>
            {overloaded && <PriorityBadge label="Перегружен" color="red" />}
          </div>
          <p
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {roleLabel}
          </p>
          <div className="flex items-center gap-1">
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-primary)' }}>{spPerDay}</span>
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>SP/д</span>
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>•</span>
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: trendUp ? 'var(--color-error)' : 'var(--color-text-primary)' }}>{activeDays}д ↑</span>
          </div>
        </div>
      </div>
      <svg viewBox="0 0 358 1" className="w-full h-[1px]" preserveAspectRatio="none" aria-hidden="true">
        <rect width="358" height="1" fill="var(--color-text-muted)" />
      </svg>
      <div className="flex flex-col gap-1">
        {tasks.length > 0 ? (
          tasks.map((task, idx) => (
            <p key={idx} style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', lineHeight: 'var(--text-body-sm-line)', color: 'var(--color-text-muted)' }}>
              {task}
            </p>
          ))
        ) : (
          <p style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', lineHeight: 'var(--text-body-sm-line)', color: 'var(--color-text-muted)' }}>
            Нет активных задач · уточни статус
          </p>
        )}
      </div>
    </NotchedPanel>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FlowBoard({
  title = 'Флоу задач',
  currentDate = 'Четверг, 20 мая',
  sprintEnabled = false,
  sprint,
  signals = [],
  taskStatuses = [],
  workers = [],
  agents = [],
  loading = false,
  error,
  onAddWorker,
  onAddAgent,
  onRefresh,
  initData,
  workspaceId,
}: FlowBoardProps) {
  // ─── Sprint sheet state ──────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSprintClick = useCallback(() => {
    if (sprint) {
      setViewOpen(true);
    } else {
      setCreateOpen(true);
    }
  }, [sprint]);

  // Helper to build auth-aware fetch options
  const authBody = useCallback((body: Record<string, unknown>) => {
    if (initData) {
      return JSON.stringify({ ...body, init_data: initData });
    }
    return JSON.stringify(body);
  }, [initData]);

  const handleCreateSubmit = useCallback(
    async (value: SprintFormValue) => {
      if (isSubmitting) return; // Prevent double submission
      setIsSubmitting(true);
      try {
        const res = await fetch('/api/sprints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: authBody({
            name: value.name,
            start_date: value.startDate ? value.startDate.toISOString().split('T')[0] : undefined,
            end_date: value.endDate ? value.endDate.toISOString().split('T')[0] : undefined,
            goal: value.goal || null,
            capacity: value.capacity || undefined,
            workspace_id: workspaceId,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        // Fire-and-forget refresh — close sheet immediately without waiting
        void onRefresh?.({ force: true });
        setCreateOpen(false);
      } catch (err) {
        console.error('Failed to create sprint:', err);
        alert(err instanceof Error ? err.message : 'Не удалось создать спринт');
      } finally {
        setIsSubmitting(false);
      }
    },
    [onRefresh, authBody, isSubmitting, workspaceId],
  );

  const handleEditSubmit = useCallback(
    async (value: SprintFormValue) => {
      if (!sprint) return;
      try {
        const res = await fetch(`/api/sprints/${sprint.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: authBody({
            name: value.name,
            start_date: value.startDate ? value.startDate.toISOString().split('T')[0] : undefined,
            end_date: value.endDate ? value.endDate.toISOString().split('T')[0] : undefined,
            goal: value.goal || null,
            capacity: value.capacity || undefined,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        // Fire-and-forget refresh — close sheet immediately without waiting
        void onRefresh?.({ force: true });
        setEditOpen(false);
      } catch (err) {
        console.error('Failed to update sprint:', err);
        alert(err instanceof Error ? err.message : 'Не удалось обновить спринт');
      }
    },
    [sprint, onRefresh, authBody],
  );
  const handleActivate = useCallback(async () => {
    if (!sprint) return;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}/activate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: authBody({}),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      // Fire-and-forget refresh — close sheet immediately without waiting
      void onRefresh?.({ force: true });
      setViewOpen(false);
    } catch (err) {
      console.error('Failed to activate sprint:', err);
      alert(err instanceof Error ? err.message : 'Не удалось активировать спринт');
    }
  }, [sprint, onRefresh, authBody]);

  const handleComplete = useCallback(async () => {
    if (!sprint) return;
    if (!confirm('Завершить спринт?')) return;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: authBody({}),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      // Fire-and-forget refresh — close sheet immediately without waiting
      void onRefresh?.({ force: true });
      setViewOpen(false);
    } catch (err) {
      console.error('Failed to delete sprint:', err);
      alert(err instanceof Error ? err.message : 'Не удалось удалить спринт');
    }
  }, [sprint, onRefresh, authBody]);

  const handleCreateNew = useCallback(() => {
    setViewOpen(false);
    setCreateOpen(true);
  }, []);

  const sprintFormData = sprint
    ? {
        name: sprint.name,
        startDate: new Date(sprint.startDate),
        endDate: new Date(sprint.endDate),
        goal: sprint.topic,
        capacity: sprint.capacity ?? '',
      }
    : undefined;

  const stats: SprintStats | undefined = sprint
    ? {
        completedTasks: sprint.doneTasks ?? 0,
        totalTasks: parseInt(sprint.capacity ?? '0', 10) || 0,
        daysLeft: computeDaysLeft(sprint.endDate),
      }
    : undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh" style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-dvh px-4" style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}>
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
      className="
        flex flex-col w-full mx-auto
        px-4
        bg-primary-dark
        h-full
      "
      style={{
        backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))',
        maxWidth: '100%',
        margin: '0 auto',
        gap: 'var(--spacing-6)',
        minHeight: 'var(--tg-viewport-stable-height, 100dvh)',
        paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
      }}
      aria-label="Флоу задач"
    >
       {/* Header row — icon + title + date */}
       <div className="flex w-full shrink-0" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--spacing-2)' }}>
        <div className="flex items-center gap-2">
          <KanbanIcon />
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
            {title}
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

      {sprintEnabled && (
        <div onClick={handleSprintClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSprintClick(); } }} role="button" tabIndex={0} aria-label={sprint ? `Открыть спринт ${sprint.name}` : 'Создать спринт'}>
          <SprintCompressedInfo sprint={sprint} />
        </div>
      )}

       {/* Signals section — 3-column grid on mobile, responsive on larger screens */}
       {signals.length > 0 && (
         <div className="flex flex-col gap-4">
           <DeskSectionHeader title="Сигналы" />
           <div
             className="grid w-full"
             style={{
               gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
               gap: 'var(--spacing-2)',
               // Ensure cards don't overflow on small screens
               minWidth: 0,
             }}
             aria-label="Сигналы команды"
           >
            {signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </div>
      )}

       {/* Task statuses section — 2-column grid */}
       {taskStatuses.length > 0 && (
         <div className="flex flex-col gap-4">
           <DeskSectionHeader title="Статусы задач" />
           <div
             className="grid w-full"
             style={{
               gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
               gap: 'var(--spacing-2)',
               minWidth: 0,
             }}
             aria-label="Статусы задач"
           >
            {taskStatuses.map((status) => (
              <TaskStatusCard key={status.id} status={status} />
            ))}
          </div>
        </div>
      )}

      {workers.length > 0 && (
        <div className="flex flex-col gap-4">
          <DeskSectionHeader title="Участники" />
          <div className="flex flex-col gap-3">
            {workers.map((worker) => (
              <PersonCard key={worker.id} person={worker} type="worker" />
            ))}
          </div>
          <Button variant="outline" onClick={onAddWorker} aria-label="Добавить коллегу" type="button">
            Добавить коллегу
          </Button>
        </div>
      )}

      {/* Agents section — always visible for add agent CTA */}
      {agents.length > 0 && (
        <div className="flex flex-col gap-4">
          <DeskSectionHeader title="Агенты" />
          <div className="flex flex-col gap-3">
            {agents.map((agent) => (
              <PersonCard key={agent.id} person={agent} type="agent" />
            ))}
          </div>
          <Button variant="outline" onClick={onAddAgent} aria-label="Добавить Агента" type="button">
            Добавить Агента
          </Button>
        </div>
      )}

      {/* ─── Sprint Sheets ─────────────────────────────────────── */}
      {sprintEnabled && (
        <>
          <SprintCreateSheet
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSubmit={handleCreateSubmit}
          />

          {sprint && stats && sprintFormData && (
            <>
              <SprintViewSheet
                open={viewOpen}
                onClose={() => setViewOpen(false)}
                sprint={sprintFormData}
                stats={stats}
                isActive={sprint.isActive}
                status={sprint.status}
                onEdit={() => {
                  setViewOpen(false);
                  setEditOpen(true);
                }}
                onComplete={handleComplete}
                onActivate={handleActivate}
              />

              <SprintEditSheet
                open={editOpen}
                onClose={() => setEditOpen(false)}
                initialValue={sprintFormData}
                stats={stats}
                onSubmit={handleEditSubmit}
              />
            </>
          )}
        </>
      )}

       {/* Bottom spacer — accounts for safe area + breathing room */}
       <div
         className="h-16 xs:h-20 w-full shrink-0"
         style={{ backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))' }}
         aria-hidden="true"
       />
    </div>
  );
}
