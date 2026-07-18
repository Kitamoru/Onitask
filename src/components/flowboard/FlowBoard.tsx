'use client';

import React from 'react';

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
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SprintInfo {
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
}

export interface SignalData {
  id: string;
  label: string;
  count: number;
  description: string;
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
  sprint?: SprintInfo;
  signals: SignalData[];
  taskStatuses: TaskStatusData[];
  workers: WorkerCardData[];
  agents: AgentCardData[];
  loading?: boolean;
  error?: string | null;
  onAddWorker?: () => void;
  onAddAgent?: () => void;
  onRefresh?: () => void;
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

function PriorityBadge({ label, color = 'green' }: { label: string; color?: 'green' | 'amber' | 'red' | 'cyan' }) {
  const colorMap = {
    green: { bg: 'rgba(74, 222, 128, 0.2)', text: '#4ADE80', border: '#4ADE80' },
    amber: { bg: 'rgba(245, 158, 11, 0.2)', text: '#F59E0B', border: '#F59E0B' },
    red: { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444', border: '#EF4444' },
    cyan: { bg: 'rgba(34, 211, 238, 0.2)', text: '#22D3EE', border: '#22D3EE' },
  };
  const c = colorMap[color];
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 rounded"
      style={{ backgroundColor: c.bg, border: `1px solid ${c.border}`, borderRadius: '4px' }}
      aria-label={`Приоритет: ${label}`}
    >
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
      style={{ height: '8px', borderRadius: '4px' }}
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Прогресс спринта: ${progress}%`}
    >
      <svg viewBox="0 0 334 8" preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
        <rect width="334" height="8" rx="4" fill="#F59E0B" opacity="0.2" />
      </svg>
      <div
        className="absolute top-0 left-0 h-full"
        style={{ width: `${progress}%`, backgroundColor: '#F59E0B', borderRadius: '4px' }}
      />
    </div>
  );
}

function SprintCompressedInfo({ sprint }: { sprint?: SprintInfo }) {
  if (!sprint) return null;
  return (
    <div
      className="flex flex-col w-full p-3 rounded relative overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: '4px', gap: 'var(--spacing-4)' }}
      aria-label="Информация о спринте"
    >
      <div className="flex flex-col w-full gap-1">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
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
            <span style={{ color: 'var(--color-text-primary)' }}>•</span>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-lg)',
                lineHeight: 'var(--text-body-lg-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              {sprint.topic}
            </span>
          </div>
          <PriorityBadge label={sprint.isActive ? 'Активный' : 'Неактивный'} color={sprint.isActive ? 'green' : 'amber'} />
        </div>
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
            {sprint.startDate}–{sprint.endDate}
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
            День {sprint.daysElapsed}/{sprint.totalDays}
          </span>
        </div>
      </div>
      <ProgressBar progress={sprint.progress} />
      <div className="flex flex-wrap w-full gap-x-3 gap-y-2" aria-label="Статистика спринта">
        <div className="flex items-center gap-1">
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>Готово:</span>
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-primary)' }}>{sprint.doneSP}</span>
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>/ {sprint.totalSP} SP</span>
        </div>
        <div className="flex items-center gap-1">
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>В работе:</span>
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-primary)' }}>{sprint.inProgress}</span>
        </div>
        <div className="flex items-center gap-1">
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>На проверке:</span>
          <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-primary)' }}>{sprint.onReview}</span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex flex-col w-full gap-2">
      <div className="flex items-center gap-2">
        <div
          className="shrink-0"
          style={{ width: '2px', height: '18px', backgroundColor: 'var(--color-accent-amber)', borderRadius: '2px' }}
          aria-hidden="true"
        />
        <h2
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          {title}
        </h2>
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: SignalData }) {
  return (
    <div
      className="flex flex-col p-3 rounded relative overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: '4px', gap: 'var(--spacing-2)' }}
      aria-label={`Сигнал: ${signal.label}`}
    >
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-xl)',
          lineHeight: 'var(--text-body-xl-line)',
          fontWeight: 'var(--font-weight-medium)',
          textAlign: 'center' as const,
          color: signal.count <= 3 ? '#4ADE80' : 'var(--color-text-primary)',
        }}
      >
        {signal.count}
      </span>
      <div className="flex flex-col gap-0.5">
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          {signal.label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: '12px',
            lineHeight: '12px',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
          }}
        >
          {signal.description}
        </span>
      </div>
    </div>
  );
}

function TaskStatusCard({ status }: { status: TaskStatusData }) {
  return (
    <div
      className="flex flex-col p-3 rounded relative overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: '4px', gap: 'var(--spacing-3)' }}
      aria-label={`Статус: ${status.label}, ${status.count} задач`}
    >
      <div className="flex items-center gap-1">
        <div
          className="shrink-0"
          style={{ width: '12px', height: '9px', borderRadius: '2px', backgroundColor: status.color }}
          aria-hidden="true"
        />
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
            flex: 1,
          }}
        >
          {status.label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
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
              backgroundColor: idx < status.shapes ? status.color : 'rgba(255, 255, 255, 0.2)',
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

function CognitiveWeightIndicator({ weight }: { weight: number }) {
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

function UserAvatar({ displayName, avatarUrl, size = 'md' }: { displayName: string; avatarUrl?: string; size?: 'sm' | 'md' }) {
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

function PersonCard({ person, type = 'worker' }: { person: WorkerCardData | AgentCardData; type?: 'worker' | 'agent' }) {
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
    <div
      className="flex flex-col w-full rounded relative overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: '4px', gap: 'var(--spacing-3)', padding: 'var(--spacing-3)' }}
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
                fontSize: '16px',
                lineHeight: '20px',
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
              fontSize: '12px',
              lineHeight: '14px',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {roleLabel}
          </p>
          <div className="flex items-center gap-1">
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: '12px', color: 'var(--color-text-primary)' }}>{spPerDay}</span>
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: '12px', color: 'var(--color-text-muted)' }}>SP/д</span>
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: '12px', color: 'var(--color-text-muted)' }}>•</span>
            <span style={{ fontFamily: 'var(--font-family-display)', fontSize: '12px', color: trendUp ? '#EF4444' : 'var(--color-text-primary)' }}>{activeDays}д ↑</span>
          </div>
        </div>
      </div>
      <svg viewBox="0 0 358 1" className="w-full h-[1px]" preserveAspectRatio="none" aria-hidden="true">
        <rect width="358" height="1" fill="#8B8B8B" />
      </svg>
      <div className="flex flex-col gap-1">
        {tasks.length > 0 ? (
          tasks.map((task, idx) => (
            <p key={idx} style={{ fontFamily: 'var(--font-family-display)', fontSize: '12px', lineHeight: '14px', color: 'var(--color-text-muted)' }}>
              {task}
            </p>
          ))
        ) : (
          <p style={{ fontFamily: 'var(--font-family-display)', fontSize: '12px', lineHeight: '14px', color: 'var(--color-text-muted)' }}>
            Нет активных задач · уточни статус
          </p>
        )}
      </div>
    </div>
  );
}

function SecondaryButton({ label, onClick, ariaLabel }: { label: string; onClick?: () => void; ariaLabel?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center h-10 w-full rounded relative overflow-hidden transition-colors hover:bg-surface/50"
      style={{
        fontFamily: 'var(--font-family-base)',
        fontSize: 'var(--text-body-md)',
        lineHeight: 'var(--text-body-md-line)',
        fontWeight: 'var(--font-weight-semibold)',
        letterSpacing: 'var(--letter-spacing-tighter)',
        color: 'var(--color-text-primary)',
        backgroundColor: 'var(--color-bg-surface-hover)',
        border: `1px solid var(--color-border-default)`,
      }}
      aria-label={ariaLabel || label}
    >
      <span>{label}</span>
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FlowBoard({
  title = 'Флоу задач',
  currentDate = 'Четверг, 20 мая',
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
}: FlowBoardProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4" style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}>
        <div
          className="flex flex-col items-center gap-4 p-6 rounded max-w-md w-full"
          style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: '4px' }}
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
              onClick={onRefresh}
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
      className="flex flex-col mx-auto p-4"
      style={{ backgroundColor: 'var(--color-bg-primary-dark)', maxWidth: '100%', margin: '0 auto', gap: 'var(--spacing-6)', minHeight: '100vh' }}
      aria-label="Флоу задач"
    >
      <div className="flex w-full" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px' }}>
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
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-muted)',
            margin: 0,
          }}
        >
          {currentDate}
        </p>
      </div>

      <SprintCompressedInfo sprint={sprint} />

      {signals.length > 0 && (
        <div className="flex flex-col gap-4">
          <SectionHeader title="Сигналы" />
          <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }} aria-label="Сигналы команды">
            {signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </div>
      )}

      {taskStatuses.length > 0 && (
        <div className="flex flex-col gap-4">
          <SectionHeader title="Статусы задач" />
          <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }} aria-label="Статусы задач">
            {taskStatuses.map((status) => (
              <TaskStatusCard key={status.id} status={status} />
            ))}
          </div>
        </div>
      )}

      {workers.length > 0 && (
        <div className="flex flex-col gap-4">
          <SectionHeader title="Участники" />
          <div className="flex flex-col gap-3">
            {workers.map((worker) => (
              <PersonCard key={worker.id} person={worker} type="worker" />
            ))}
          </div>
          <SecondaryButton label="Добавить коллегу" onClick={onAddWorker} ariaLabel="Добавить коллегу" />
        </div>
      )}

      {agents.length > 0 && (
        <div className="flex flex-col gap-4">
          <SectionHeader title="Агенты" />
          <div className="flex flex-col gap-3">
            {agents.map((agent) => (
              <PersonCard key={agent.id} person={agent} type="agent" />
            ))}
          </div>
          <SecondaryButton label="Добавить Агента" onClick={onAddAgent} ariaLabel="Добавить Агента" />
        </div>
      )}

      <div className="h-20" style={{ backgroundColor: 'var(--color-bg-primary-dark)' }} aria-hidden="true" />
    </div>
  );
}