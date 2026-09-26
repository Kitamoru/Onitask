/**
 * CalendarTabs — День / Месяц switcher.
 *
 * Pattern from /boards: inline styles on the shared tokens. Two segments only:
 * a Telegram Mini App lives in a draggable BottomSheet, and a four-way
 * switcher does not fit the height it opens at.
 */

'use client';

import React from 'react';
import type { CalendarViewMode } from '@/types/calendar';

interface CalendarTabsProps {
  activeMode: CalendarViewMode;
  onModeChange: (mode: CalendarViewMode) => void;
}

const TABS: { key: CalendarViewMode; label: string }[] = [
  { key: 'day', label: 'День' },
  { key: 'month', label: 'Месяц' },
];

export function CalendarTabs({ activeMode, onModeChange }: CalendarTabsProps) {
  return (
    <div
      className="flex items-center px-3 py-2"
      style={{
        gap: '6px',
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'var(--color-bg-dark)',
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeMode === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onModeChange(tab.key)}
          className="flex items-center justify-center rounded-lg transition-all duration-fast active:scale-95"
          style={{
            height: '32px',
            // flex: 1 ensures each tab expands equally to fill available space
            flex: 1,
            padding: '0 12px',
              fontSize: '13px',
              fontWeight: isActive ? '600' : '500',
              fontFamily: "var(--font-family-display, system-ui, sans-serif)",
              lineHeight: '16px',
              backgroundColor: isActive
                ? 'var(--color-accent-amber)'
                : 'var(--color-bg-surface)',
              color: isActive
                ? 'var(--color-text-white)'
                : 'var(--color-text-muted)',
              border: !isActive
                ? '1px solid var(--color-border-white-subtle)'
                : 'none',
            }}
            aria-pressed={isActive}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}