'use client';

/**
 * WorkerSheet — bottom sheet с деталями воркера (Figma 622:29869 / 622:30273).
 *
 * Два таба (desk-ui `Segments`):
 *  - «Статус»  — метрики (velocity, rework, forecast, gap) + задачи в `in_progress`/`review`
 *  - «Доступы»  — read-only UI этой итерации: роль + пресет доступа, кнопки «Сохранить»/«Отозвать доступ»
 *
 * Метрики считаются на клиенте из board-tasks + спринта. Reworks (← task_column_history) пока
 * не запрашиваются — показываем 0 с заготовкой под будущее подключение.
 */

import { useMemo, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Segments } from '@/components/ui/desk-ui';
import { Button } from '@/components/ui/desk-ui';
import { TaskCard } from '@/components/stream/StreamView';
import {
  UserAvatar,
  CognitiveWeightIndicator,
  PriorityBadge,
} from '@/components/flowboard/FlowBoard';
import type { TaskEntity } from '@/types/flowboard';
import type { WorkerCardData, SprintInfo } from '@/types/flowboard';

const METRIC_WINDOW_DAYS = 14;

export type WorkerSheetTab = 'status' | 'access';

export interface WorkerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Воркер, по которому открыт sheet */
  worker: WorkerCardData;
  /** Все задачи текущей доски */
  tasks: TaskEntity[];
  /** Активный спринт (если включён) */
  sprint?: SprintInfo | null;
}

const SEGMENTS: { value: WorkerSheetTab; label: string }[] = [
  { value: 'status', label: 'Статус' },
  { value: 'access', label: 'Доступы' },
];

// Read-only: роль в доске, маппится из известных ролей воркспейса.
const ROLE_DISPLAY: Record<string, string> = {
  owner: '👑 Владелец',
  admin: '⚙️ Администратор',
  member: '👤 Участник',
  viewer: '👁 Наблюдатель',
};

export function WorkerSheet({ open, onClose, worker, tasks, sprint }: WorkerSheetProps) {
  const [tab, setTab] = useState<WorkerSheetTab>('status');

  // Задачи воркера в `in_progress` (назначенные исполнителем) и `review` (проверяющий)
  const inProgressTasks = useMemo(
    () => tasks.filter((t) => t.assigned_to === worker.id && t.column === 'in_progress'),
    [tasks, worker.id],
  );
  const reviewTasks = useMemo(
    () => tasks.filter((t) => t.reviewer_id === worker.id && t.column === 'review'),
    [tasks, worker.id],
  );
  const workingTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.assigned_to === worker.id &&
          (t.column === 'in_progress' || t.column === 'review'),
      ),
    [tasks, worker.id],
  );

  // Метрики считаются на клиенте
  const metrics = useMemo(() => {
    const velocity = worker.spPerDay; // SP/день
    let daysLeft = METRIC_WINDOW_DAYS;
    if (sprint && sprint.isActive) {
      daysLeft = Math.max(0, sprint.totalDays - sprint.daysElapsed);
    }
    const forecastSP = velocity * daysLeft;
    const assignedSP = workingTasks.reduce((sum, t) => sum + (t.story_points ?? 0), 0);
    const gap = assignedSP - forecastSP;
    return {
      velocity,
      periodDays: METRIC_WINDOW_DAYS,
      rework: 0, // TODO: task_column_history
      daysLeft,
      forecastSP,
      assignedSP,
      gap,
    };
  }, [worker.spPerDay, workingTasks, sprint]);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col" role="dialog" aria-modal="true" aria-label="Воркер">
        {/* 1. Header — worker card (Figma 622:29872) */}
        <WorkerHeader worker={worker} metrics={metrics} />

        {/* 2. Сегменты — Статус / Доступы */}
        <div className="px-4">
          <Segments<WorkerSheetTab>
            options={SEGMENTS}
            value={tab}
            onChange={setTab}
            aria-label="Вкладки воркера"
          />
        </div>

        {tab === 'status' && (
          <div className="flex flex-col gap-6 px-4">
            <StatusMetrics metrics={metrics} />
            <TaskSection
              color="var(--color-accent-amber)"
              title="В работе"
              tasks={inProgressTasks}
              emptyNote="Нет задач в работе"
            />
            <TaskSection
              color="var(--color-signal-cyan)"
              title={`На проверке (${reviewTasks.length})`}
              tasks={reviewTasks}
              emptyNote="На проверке пока нет задач"
            />
          </div>
        )}

                {tab === 'access' && <AccessTab worker={worker} />}
      </div>
    </BottomSheet>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────────

function WorkerHeader({
  worker,
  metrics,
}: {
  worker: WorkerCardData;
  metrics: { velocity: number };
}) {
  const captionStyle: React.CSSProperties = {
    fontFamily: 'var(--font-family-display)',
    fontSize: 'var(--text-body-sm)',
    lineHeight: '18px',
    fontWeight: 500,
    color: '#8B8B8B',
  };

  return (
    <div
      className="relative flex flex-col gap-3 px-4 py-12"
      style={{ width: 390, backgroundColor: '#0A0A0A' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <UserAvatar displayName={worker.displayName} avatarUrl={worker.avatarUrl} />
          <CognitiveWeightIndicator weight={worker.cognitiveWeight} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: '16px',
                lineHeight: '20px',
                fontWeight: 500,
                color: '#FAFAFA',
              }}
            >
              {worker.displayName}
            </span>
            {worker.overloaded && <PriorityBadge label="Перегружен" color="red" />}
          </div>

          <p style={captionStyle}>
            {worker.type === 'agent' ? 'AI-агент' : 'Пользователь'} · {worker.roleLabel}
          </p>

          <div className="flex items-center gap-1">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 500,
                color: '#FAFAFA',
              }}
            >
              {metrics.velocity}
            </span>
            <span style={captionStyle}>SP/д</span>
            <span style={captionStyle}>•</span>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 500,
                color: worker.trendUp ? 'var(--color-error)' : '#FAFAFA',
              }}
            >
                            {worker.activeDays}д ↑
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status: метрики ───────────────────────────────────────────────────────────

interface StatusMetricsProps {
  metrics: {
    velocity: number;
    periodDays: number;
    rework: number;
    forecastSP: number;
    assignedSP: number;
    gap: number;
  };
}

function MetricCard({
  value,
  sub,
  caption,
}: {
  value: string;
  sub: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: '14px',
          lineHeight: '18px',
          fontWeight: 500,
          color: '#FAFAFA',
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          color: '#8B8B8B',
        }}
      >
        {sub}
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '11px',
          lineHeight: '14px',
          color: '#8B8B8B',
        }}
      >
        {caption}
      </span>
    </div>
  );
}

function StatusMetrics({ metrics }: StatusMetricsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MetricCard
        value={String(metrics.velocity)}
        sub={`${metrics.velocity} SP/день · ${metrics.periodDays}д`}
        caption="Скорость"
      />
      <MetricCard
        value={String(metrics.rework)}
        sub={`Rework · ${metrics.periodDays}д`}
        caption="Переработки"
      />

      <div className="col-span-2 flex flex-col gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <MetricRow label="Прогноз" value={`${metrics.forecastSP.toFixed(1)} SP`} muted />
        <MetricRow label="Назначено" value={`${metrics.assignedSP} SP`} accent />
        {metrics.gap > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: '18px',
              fontWeight: 500,
              color: '#EF4444',
            }}
          >{`Gap +${metrics.gap.toFixed(1)} SP → риск`}</span>
        )}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  muted = false,
  accent = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: muted ? '#8B8B8B' : '#FAFAFA',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: accent ? '#F59E0B' : '#FAFAFA',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Status: секции задач ──────────────────────────────────────────────────────

function TaskSection({
  color,
  title,
  tasks,
  emptyNote,
}: {
  color: string;
  title: string;
  tasks: TaskEntity[];
  emptyNote: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div
          style={{ width: 2, height: 18, borderRadius: 2, backgroundColor: color }}
          aria-hidden="true"
        />
        <h3
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: 500,
            color: '#FAFAFA',
          }}
        >
          {title}
        </h3>
      </div>

      {tasks.length === 0 ? (
        <p
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: 'var(--text-body-sm-line)',
            color: '#8B8B8B',
          }}
        >
          {emptyNote}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
                    {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Access tab (UI-only) ──────────────────────────────────────────────────────

function AccessTab({ worker }: { worker: WorkerCardData }) {
  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      {/* Роль в доске — read-only поле */}
      <FieldGroup label="Роль в доске">
        <ReadOnlyField value={ROLE_DISPLAY[worker.roleLabel] ?? worker.roleLabel} />
      </FieldGroup>

      {/* Пресет доступов — селектор (выключен в UI-only итерации) */}
      <FieldGroup label="Пресет доступов">
        <SelectField value="Руководитель" />
        <HelperText>
          «Руководитель» обладает <u>этими доступами</u>
        </HelperText>
      </FieldGroup>

      {/* Кнопки */}
      <div className="flex flex-col gap-3 pt-2">
        <Button
          type="button"
          variant="solid"
          onClick={() => alert('Сохранение доступа will be available soon')}
        >
          Сохранить информацию
        </Button>
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: '18px',
            fontWeight: 500,
            color: '#8B8B8B',
            textAlign: 'center',
          }}
          className="text-center"
        >
                    вы также может
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => alert('Отзыв доступа will be available soon')}
        >
          Отозвать доступ
        </Button>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: '#8B8B8B',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnlyField({ value }: { value: string }) {
  return (
    <div
      className="flex w-full items-center rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
      style={{ height: 40 }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: '20px',
          fontWeight: 500,
          color: '#FAFAFA',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SelectField({ value }: { value: string }) {
  return (
    <div
      className="flex w-full items-center justify-between rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
      style={{ height: 40 }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: '20px',
          fontWeight: 500,
          color: '#FAFAFA',
        }}
      >
        {value}
      </span>
      <svg width={20} height={20} viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <path
          d="M4.25 6.25L8.5 10.5L12.75 6.25"
          stroke="#8B8B8B"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function HelperText({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '12px',
        lineHeight: '14px',
        fontWeight: 400,
        color: '#8B8B8B',
      }}
    >
      {children}
    </p>
  );
}

