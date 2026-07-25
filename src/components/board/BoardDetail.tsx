'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button, SectionHeader, Stepper } from '@/components/ui/desk-ui';

/**
 * BoardDetail component — displays the content of a single board/workspace.
 * 
 * Figma spec (node 1:836 "desk / [desk_UUID] / edit"):
 *   - Main frame: column, gap=24px, maxWidth=390px, bg=#0A0A0A
 *   - Header section: desk icon (20x20) + "Доска" title + board count line
 *   - Center container (flex-col, gap=16px):
 *     - Sprints section: section header + task cards grid (3 columns) + "К спринту" button
 *     - Colleagues section: section header + worker cards list + "Добавить коллегу" button
 *     - External links section: section header + link items
 *     - Documents section: section header + file items
 *     - Work logic section: section header + counter controls
 *   - Trailing bar: "Редактировать доску" primary button (full width)
 *   - Bottom filler: 80px
 * 
 * Uses UI components from desk-ui (Button, SectionHeader, Stepper).
 * All styling via design tokens from src/styles/tokens.css.
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
}

export interface TaskCardData {
  id: string;
  title: string;
  column: string;
}

export interface WorkerCardData {
  id: string;
  displayName: string;
  avatarUrl?: string;
  cognitiveWeight: number;
  spPerDay: number;
  trendUp: boolean;
  roleLabel: string;
  activeTasks: number;
  overloaded: boolean;
  tasks: string[];
}

export interface ExternalLinkData {
  id: string;
  label: string;
  url: string;
}

export interface DocumentData {
  id: string;
  filename: string;
  fileType: 'markdown' | 'text';
}

export interface BoardDetailProps {
  boardName: string;
  slug: string;
  sprint?: SprintInfo;
  sprintTasks: TaskCardData[];
  colleagues: WorkerCardData[];
  externalLinks: ExternalLinkData[];
  documents: DocumentData[];
  deadlineWarningDays: number;
  boardSettings?: {
    spCostEnabled: boolean;
    cognitiveWeightEnabled: boolean;
    context: string;
  };
  loading?: boolean;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SprintSection({
  sprint,
  tasks,
  onSprintClick,
}: {
  sprint?: SprintInfo;
  tasks: TaskCardData[];
  onSprintClick?: () => void;
}) {
  if (!sprint) return null;

  const columns = [
    { label: 'Люди', count: tasks.filter((t) => t.column === 'people').length, taskList: tasks.filter((t) => t.column === 'people') },
    { label: 'Процессы', count: tasks.filter((t) => t.column === 'process').length, taskList: tasks.filter((t) => t.column === 'process') },
    { label: 'Эскалации', count: tasks.filter((t) => t.column === 'escalation').length, taskList: tasks.filter((t) => t.column === 'escalation') },
  ];

  return (
    <div className="flex flex-col w-full gap-3">
      <SectionHeader title="Спринты" />

      {/* Sprint info line */}
      <p
        className="text-center text-accent-amber"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {sprint.name} • {sprint.topic} • {sprint.startDate}–{sprint.endDate}
      </p>

      {/* 3-column task grid */}
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--spacing-3)',
        }}
      >
        {columns.map(({ label, count, taskList }) => (
          <div
            key={label}
            className="flex flex-col rounded-sm"
            style={{
              padding: 'var(--spacing-3)',
              gap: 'var(--spacing-2)',
              backgroundColor: 'var(--color-bg-surface)',
              border: `1px solid var(--color-border-default)`,
            }}
          >
            <p
              className="text-center text-muted"
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
              }}
            >
              {label}
            </p>
            <p
              className="text-center"
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-heading-md)',
                lineHeight: 'var(--text-heading-md-line)',
                fontWeight: 'var(--font-weight-semibold)',
                color: count > 10 ? 'var(--color-error)' : 'var(--color-text-white)',
              }}
            >
              {count}
            </p>
            {taskList.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {taskList.slice(0, 2).map((task) => (
                  <p
                    key={task.id}
                    className="text-center truncate text-accent-amber"
                    style={{
                      fontFamily: 'var(--font-family-display)',
                      fontSize: 'var(--text-body-xs)',
                      lineHeight: 'var(--text-body-xs-line)',
                      fontWeight: 'var(--font-weight-regular)',
                    }}
                  >
                    {task.title}
                  </p>
                ))}
                {taskList.length > 2 && (
                  <p
                    className="text-center text-muted"
                    style={{
                      fontFamily: 'var(--font-family-display)',
                      fontSize: 'var(--text-body-xs)',
                      lineHeight: 'var(--text-body-xs-line)',
                      fontWeight: 'var(--font-weight-regular)',
                    }}
                  >
                    +{taskList.length - 2}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* "К спринту" button */}
      <Button variant="solid" onClick={onSprintClick}>
        К спринту
      </Button>
    </div>
  );
}

function WorkerCard({ worker }: { worker: WorkerCardData }) {
  return (
    <div
      className="flex flex-col w-full rounded overflow-hidden relative"
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: `1px solid var(--color-border-default)`,
        gap: 'var(--spacing-3)',
        padding: 'var(--spacing-3)',
      }}
    >
      {/* Top row: avatar + weight indicator | name + priority badge */}
      <div className="flex items-start gap-3">
        {/* Avatar + cognitive weight */}
        <div className="flex flex-col items-center gap-1">
          {/* User avatar */}
          <div
            className="relative shrink-0 overflow-hidden"
            style={{
              width: 'var(--size-avatar)',
              height: 'var(--size-avatar)',
              borderRadius: 'var(--radius-xs)',
            }}
          >
            {worker.avatarUrl ? (
              <img
                src={worker.avatarUrl}
                alt=""
                className="object-cover w-full h-full"
                aria-hidden="true"
              />
            ) : (
              <div
                className="flex items-center justify-center w-full h-full"
                style={{ backgroundColor: 'var(--color-bg-surface-hover)' }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-family-display)',
                    fontSize: 'var(--text-body-sm)',
                    fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {worker.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Cognitive weight indicator */}
          <CognitiveWeightIndicator weight={worker.cognitiveWeight} />
        </div>

        {/* Name + priority */}
        <div className="flex flex-col flex-1 gap-1">
          <div className="flex items-center justify-between">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              {worker.displayName}
            </span>
            {worker.overloaded && (
              <div
                className="flex items-center gap-1 px-1 py-0.5 rounded"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  border: `1px solid var(--color-error)`,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-family-base)',
                    fontSize: 'var(--text-body-sm)',
                    lineHeight: 'var(--text-body-sm-line)',
                    fontWeight: 'var(--font-weight-semibold)',
                    letterSpacing: 'var(--letter-spacing-tighter)',
                    color: 'var(--color-error)',
                  }}
                >
                  Перегружен
                </span>
              </div>
            )}
          </div>

          {/* Role label */}
          <p
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-accent-amber)',
            }}
          >
            {worker.roleLabel}
          </p>

          {/* Metrics row */}
          <div className="flex items-center gap-1">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              {worker.spPerDay}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-accent-amber)',
              }}
            >
              SP/д
            </span>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-accent-amber)',
              }}
            >
              •
            </span>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: worker.trendUp ? 'var(--color-error)' : 'var(--color-text-primary)',
              }}
            >
              {worker.trendUp ? '↑' : '↓'}{worker.activeTasks}д
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          height: '1px',
          backgroundColor: 'var(--color-border-default)',
        }}
        aria-hidden="true"
      />

      {/* Active tasks list */}
      <div className="flex flex-col gap-1">
        {worker.tasks.length > 0 ? (
          worker.tasks.map((task, idx) => (
            <p
              key={idx}
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-accent-amber)',
              }}
            >
              {task}
            </p>
          ))
        ) : (
          <p
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            Нет активных задач · уточни статус
          </p>
        )}
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
            borderRadius: 'var(--radius-xs)',
            backgroundColor: idx < weight ? 'var(--color-accent-amber)' : 'transparent',
            border: idx < weight ? 'none' : `1.5px solid var(--color-text-secondary)`,
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ColleaguesSection({
  colleagues,
  onAddClick,
}: {
  colleagues: WorkerCardData[];
  onAddClick?: () => void;
}) {
  return (
    <div className="flex flex-col w-full gap-3">
      <SectionHeader title="Коллеги" />

      <div className="flex flex-col gap-3">
        {colleagues.map((worker) => (
          <WorkerCard key={worker.id} worker={worker} />
        ))}
      </div>

      <Button variant="solid" onClick={onAddClick}>
        Добавить коллегу
      </Button>
    </div>
  );
}

function LinkItem({ link }: { link: ExternalLinkData }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-2.5 py-2 rounded transition-colors hover:opacity-80"
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: `1px solid var(--color-border-default)`,
      }}
      aria-label={`Открыть ссылку: ${link.label}`}
    >
      {/* Link icon */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M6.5 2.5L9.5 5.5M9.5 2.5L6.5 5.5M3.5 9.5L0.5 6.5M0.5 9.5L3.5 6.5"
          stroke="var(--color-text-primary)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="flex-1 min-w-0"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-primary)',
        }}
      >
        {link.label}
      </span>
      {/* Chevron right */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M4.5 3L7.5 6L4.5 9"
          stroke="var(--color-text-muted)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

function ExternalLinksSection({
  links,
}: {
  links: ExternalLinkData[];
}) {
  return (
    <div className="flex flex-col w-full gap-3">
      <SectionHeader title="Внешние ссылки" />

      <div className="flex flex-col gap-3">
        {links.map((link) => (
          <LinkItem key={link.id} link={link} />
        ))}
      </div>
    </div>
  );
}

function DocumentItem({ doc }: { doc: DocumentData }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-2 rounded transition-colors hover:opacity-80"
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: `1px solid var(--color-border-default)`,
      }}
      role="button"
      tabIndex={0}
      aria-label={`Документ: ${doc.filename}`}
    >
      {/* File icon */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M7.5 0H2.5C2.22386 0 2 0.223858 2 0.5V11.5C2 11.7761 2.22386 12 2.5 12H9.5C9.77614 12 10 11.7761 10 11.5V3.5C10 3.39543 9.95895 3.29784 9.88388 3.22278L7.27722 0.616121C7.20215 0.541052 7.10457 0.5 7 0.5H7.5Z"
          stroke="var(--color-text-primary)"
          strokeWidth="1"
        />
        <path
          d="M7 0V3H10"
          stroke="var(--color-text-primary)"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="flex-1 min-w-0"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-primary)',
        }}
      >
        {doc.filename}
      </span>
      {/* Chevron right */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M4.5 3L7.5 6L4.5 9"
          stroke="var(--color-text-muted)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function DocumentsSection({
  documents,
}: {
  documents: DocumentData[];
}) {
  return (
    <div className="flex flex-col w-full gap-3">
      <SectionHeader title="Документы" />

      <div className="flex flex-col gap-3">
        {documents.map((doc) => (
          <DocumentItem key={doc.id} doc={doc} />
        ))}
      </div>
    </div>
  );
}

function WorkLogicSection({
  warningDays,
  onChangeWarningDays,
}: {
  warningDays: number;
  onChangeWarningDays: (v: number) => void;
}) {
  return (
    <div className="flex flex-col w-full gap-3">
      <SectionHeader title="Логика работы" />

      <div className="flex flex-col gap-3">
        <Stepper
          value={warningDays >= 1 ? 1 : 0}
          min={0}
          max={1}
          onChange={(v) => onChangeWarningDays(v)}
          unitLabel={() => "1 день"}
          borderGradient={["var(--color-grad-add-from)", "var(--color-grad-add-to)"]}
        />
        <Stepper
          value={warningDays >= 3 ? 1 : 0}
          min={0}
          max={1}
          onChange={(v) => onChangeWarningDays(v)}
          unitLabel={() => "3 дня"}
          borderGradient={["var(--color-grad-add-from)", "var(--color-grad-add-to)"]}
        />
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function BoardDetail({
  boardName,
  slug,
  sprint,
  sprintTasks,
  colleagues,
  externalLinks,
  documents,
  deadlineWarningDays,
  loading = false,
}: BoardDetailProps) {
  const router = useRouter();

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

  return (
    <div
      className="flex flex-col min-h-screen p-4 form-container"
      style={{
        backgroundColor: 'var(--color-bg-primary-dark)',
        margin: '0 auto',
        gap: 'var(--spacing-section-gap)',
      }}
    >
      {/* Header section */}
      <div className="flex flex-col items-center gap-1">
        {/* Desk icon + title */}
        <div className="flex items-center gap-2">
          {/* Desktop device icon (20x20) */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="16" height="11" rx="1.5" stroke="var(--color-accent-amber)" strokeWidth="1.5" />
            <rect x="7" y="14" width="6" height="2" rx="0.5" fill="var(--color-accent-amber)" />
            <rect x="5" y="16" width="10" height="1" rx="0.5" fill="var(--color-accent-amber)" />
          </svg>
          <h1
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'clamp(1.25rem, 2vw, 1.25rem)',
              lineHeight: '1.5',
              fontWeight: 'var(--font-weight-medium)',
              letterSpacing: '-0.025em',
              color: 'var(--color-text-primary)',
            }}
          >
            Доска
          </h1>
        </div>

        {/* Board count + active slug */}
        <div className="flex items-center gap-1">
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-accent-amber)',
            }}
          >
            1 доска • активная:
          </span>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-accent-amber)',
            }}
          >
            @{slug}
          </span>
        </div>
      </div>

      {/* Center container */}
      <div className="flex flex-col gap-4">
        {/* Sprints section */}
        <SprintSection
          sprint={sprint}
          tasks={sprintTasks}
          onSprintClick={() => router.push(`/board/${slug}/sprints`)}
        />

        {/* Colleagues section */}
        <ColleaguesSection
          colleagues={colleagues}
          onAddClick={() => router.push(`/board/${slug}/members`)}
        />

        {/* External links section */}
        <ExternalLinksSection links={externalLinks} />

        {/* Documents section */}
        <DocumentsSection documents={documents} />

        {/* Work logic section */}
        <WorkLogicSection
          warningDays={deadlineWarningDays}
          onChangeWarningDays={() => {}}
        />
      </div>

      {/* Trailing bar: Edit button (full width) */}
      <Button variant="solid" onClick={() => router.push(`/board/${slug}/edit`)}>
        Редактировать доску
      </Button>

      {/* Bottom filler: 80px */}
      <div
        style={{
          height: '80px',
        }}
        aria-hidden="true"
      />
    </div>
  );
}