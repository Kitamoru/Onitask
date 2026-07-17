'use client';

import React from 'react';

/**
 * BoardCard component — displays a single board/workspace card.
 * 
 * Figma spec (node 307:28401 "stol", task-card instances):
 *   - layout_76bd0b18: mode=column, padding=12px, gap=12px
 *   - desk-info (EL-12e2d7a9): mode=row, gap=12px
 *   - desk-logo (EL-8d2d296c): 36x36, borderRadius=1.6px
 *   - desk name (EL-9b098eb6): body/16-20 m, #FAFAFA, 16px/20px Medium
 *   - additional-info (EL-3c93974b): mode=row, gap=4px
 *   - slug (EL-0e7867c5): body/12-14 m, #8B8B8B, 12px/14px Medium
 *   - separator (EL-7c0cae01): body/12-14 m, #8B8B8B
 *   - member count (EL-62e6f123): body/12-14 m, #8B8B8B, 12px/14px Medium
 *   - task-params (EL-490b4247): grid, repeat(4,minmax(0,1fr)), gap=4px
 *   - stat item (EL-81a28a7e): padding=8px 4px, gap=2px
 *   - stat value (EL-73ad96a7): style_939c6021, #FFFFFF, 16px/20px SemiBold, center
 *   - stat label (EL-350bbfdb): style_36b55a2c, #8B8B8B, 10px/12px Medium, center/TOP
 *   - divider (EL-bc4732df): height=1px
 *   - sprint-info (EL-3c93974b): mode=row, gap=4px
 *   - sprint text (EL-aa25bcd6 etc): style_c414909c, #8B8B8B, 12px/14px Medium
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */

export interface BoardStats {
  inWork: number;
  escalations: number;
  overloaded: number;
  done: number;
}

export interface SprintInfo {
  name: string;
  topic: string;
  daysElapsed: number;
  totalDays: number;
}

export interface BoardCardData {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string;
  memberCount: number;
  agentCount: number;
  stats: BoardStats;
  sprint?: SprintInfo;
}

export interface BoardCardProps {
  data: BoardCardData;
  /** Optional click handler to navigate to the board */
  onClick?: () => void;
  /** Whether this board is currently active */
  isActive?: boolean;
}

export function BoardCard({ data, onClick, isActive }: BoardCardProps) {
  const handleClick = onClick ? () => onClick() : undefined;

  return (
    <div
      className="flex flex-col rounded-card transition-colors hover:bg-surface/50 card-stretch"
      style={{
        padding: 'var(--spacing-3)',
        gap: 'var(--spacing-3)',
        backgroundColor: 'var(--color-bg-surface)',
        border: `1px solid var(--color-border-default)`,
        cursor: 'pointer',
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`Доска ${data.name}`}
    >
      {/* Desk info row: logo + name + metadata */}
      <div
        className="flex items-center"
        style={{
          alignSelf: 'stretch',
          alignItems: 'center',
          gap: 'var(--spacing-3)',
        }}
      >
        {/* Avatar/logo */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{
            width: 'var(--size-avatar)',
            height: 'var(--size-avatar)',
            borderRadius: 'var(--radius-xs)',
          }}
        >
          {data.avatarUrl ? (
            <img
              src={data.avatarUrl}
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
                className="text-body-md font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {data.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Board name and metadata */}
        <div className="flex flex-col" style={{ gap: 'var(--spacing-0.5)' }}>
          {/* Board name */}
          <p
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-heading-md)',
              lineHeight: 'var(--text-heading-md-line)',
              fontWeight: 'var(--font-weight-medium)',
              textAlign: 'left' as const,
              color: 'var(--color-text-primary)',
            }}
          >
            {data.name}
          </p>

          {/* Additional info: @slug • member count */}
          <div className="flex items-center" style={{ gap: 'var(--spacing-1)' }}>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-muted)',
              }}
            >
              @{data.slug}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: 'var(--text-body-sm-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-muted)',
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
                color: 'var(--color-text-muted)',
              }}
            >
              {data.memberCount} участника + {data.agentCount} агента
            </span>
          </div>
        </div>
      </div>

      {/* Task stats grid */}
      <div
        className="grid w-full grid-responsive"
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        }}
      >
        <StatItem label="В работе" value={data.stats.inWork} />
        <StatItem label="Эскалации" value={data.stats.escalations} />
        <StatItem label="Перегружен" value={data.stats.overloaded} />
        <StatItem label="Готово" value={data.stats.done} />
      </div>

      {/* Divider */}
      <div
        style={{
          height: '1px',
          backgroundColor: 'var(--color-text-muted)',
        }}
        aria-hidden="true"
      />

      {/* Sprint info */}
      {data.sprint && (
        <SprintRow sprint={data.sprint} />
      )}
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: number;
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <div
      className="flex flex-col"
      style={{
        padding: 'var(--spacing-2) var(--spacing-1)',
        gap: 'var(--spacing-0.5)',
      }}
    >
      {/* Value */}
      <p
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-heading-md)',
          lineHeight: 'var(--text-heading-md-line)',
          fontWeight: 'var(--font-weight-semibold)',
          textAlign: 'center' as const,
          color: 'var(--color-text-white)',
        }}
      >
        {value}
      </p>
      {/* Label */}
      <p
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-xs)',
          lineHeight: 'var(--text-body-xs-line)',
          fontWeight: 'var(--font-weight-medium)',
          textAlign: 'center' as const,
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </p>
    </div>
  );
}

interface SprintRowProps {
  sprint: SprintInfo;
}

function SprintRow({ sprint }: SprintRowProps) {
  return (
    <div className="flex items-center" style={{ gap: 'var(--spacing-1)' }}>
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-muted)',
        }}
      >
        {sprint.name}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-muted)',
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
          color: 'var(--color-text-muted)',
        }}
      >
        {sprint.topic}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-muted)',
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
          color: 'var(--color-text-muted)',
        }}
      >
        {sprint.daysElapsed}/{sprint.totalDays} дней
      </span>
    </div>
  );
}