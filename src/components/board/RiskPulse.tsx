'use client';

import React from 'react';

/**
 * RiskPulse component — displays aggregated risk metrics across all boards.
 * 
 * Figma spec (node 307:28401 "stol"):
 *   - Section title: "Сводка по всем моим доскам" — Inter Display Medium 14px/16px, #8B8B8B
 *   - Grid of 3 cards: Люди, Процессы, Эскалации
 *   - Each card: padding 12px, gap 8px
 *   - Card title: Inter Display Medium 14px/16px, #8B8B8B
 *   - Card value: Inter Display SemiBold 16px/20px, #FFFFFF (or #EF4444 for alerts)
 *   - Button: "К спринту", height 40px, padding 0 16px, bg=#FAFAFA text, body/14-18 sb
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */

export interface RiskPulseData {
  people: number;
  processes: number;
  escalations: number;
}

export interface RiskPulseProps {
  /** Aggregated risk data from all boards */
  data: RiskPulseData;
  /** Optional callback when sprint card is clicked */
  onSprintClick?: () => void;
}

const pulseCards = [
  { label: 'Люди', key: 'people' as const },
  { label: 'Процессы', key: 'processes' as const },
  { label: 'Эскалации', key: 'escalations' as const },
];

export function RiskPulse({ data, onSprintClick }: RiskPulseProps) {
  return (
    <div className="flex flex-col w-full gap-4">
      {/* Section title */}
      <p
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-md)',
          lineHeight: 'var(--text-body-md-line)',
          fontWeight: 'var(--font-weight-medium)',
          textAlign: 'left' as const,
          color: 'var(--color-text-muted)',
        }}
      >
        Сводка по всем моим доскам
      </p>

      {/* Risk cards grid — always 3 equal columns */}
      <div
        className="grid w-full gap-2 sm:gap-4 grid-cols-3"
      >
        {pulseCards.map(({ label, key }) => (
          <RiskCard key={key} label={label} value={data[key]} onClick={onSprintClick} />
        ))}
      </div>
    </div>
  );
}

interface RiskCardProps {
  label: string;
  value: number;
  onClick?: () => void;
}

function RiskCard({ label, value, onClick }: RiskCardProps) {
  // Determine color based on value thresholds (from Figma: Processes=1 uses #EF4444)
  const textColor = value > 10 ? 'var(--color-error)' : 'var(--color-text-white)';

  return (
    <div
      className="flex flex-col rounded-card transition-colors hover:bg-surface/50 cursor-pointer"
      style={{
        padding: 'var(--spacing-3)',
        gap: 'var(--spacing-2)',
        backgroundColor: 'var(--color-bg-surface)',
        border: `1px solid var(--color-border-default)`,
      }}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`${label}: ${value}`}
    >
      {/* Label */}
      <p
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-md)',
          lineHeight: 'var(--text-body-md-line)',
          fontWeight: 'var(--font-weight-medium)',
          textAlign: 'center' as const,
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </p>

      {/* Value */}
      <p
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-heading-md)',
          lineHeight: 'var(--text-heading-md-line)',
          fontWeight: 'var(--font-weight-semibold)',
          textAlign: 'center' as const,
          color: textColor,
        }}
      >
        {value}
      </p>
    </div>
  );
}