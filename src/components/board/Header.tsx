'use client';

import React from 'react';

/**
 * Header component for the "Create Board" screen.
 * 
 * Figma spec (node 428:34028-32):
 *   - Row layout with space-between, alignItems: center
 *   - Amber accent line (2x18px, #F59E0B)
 *   - Title text: Inter Display, Medium, 14px, lineHeight: 18px, color: #FAFAFA
 *   - Text: "Основное", "Функциональное", etc.
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface HeaderProps {
  /** Section title text */
  title: string;
  /** Optional close/action button on the right */
  action?: React.ReactNode;
}

export function BoardHeader({ title, action }: HeaderProps) {
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2 min-w-0">
        {/* Amber accent line */}
        <div
          className="bg-accent-amber shrink-0"
          style={{ 
            width: 'var(--size-accent-line-width)', 
            height: 'var(--size-accent-line-height)' 
          }}
          aria-hidden="true"
        />
        {/* Section title */}
        <h2
          className="text-primary truncate"
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
          }}
          aria-label={title}
        >
          {title}
        </h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}