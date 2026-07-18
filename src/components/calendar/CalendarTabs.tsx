/**
 * CalendarTabs — View mode switcher (mobile-friendly)
 * 
 * Pattern from /boards: inline styles, maxWidth 390px, padding 16px
 * Mobile pattern: horizontal scrollable pill buttons with active indicator
 */

'use client';

import React from 'react';
import type { CalendarViewMode } from '@/types/calendar';

interface CalendarTabsProps {
  activeMode: CalendarViewMode;
  onModeChange: (mode: CalendarViewMode) => void;
}

const TABS: { key: CalendarViewMode; label: string }[] = [
  { key: 'month-list', label: 'Месяц' },
  { key: 'day', label: 'День' },
  { key: 'list', label: 'Список' },
];

export function CalendarTabs({ activeMode, onModeChange }: CalendarTabsProps) {
  return (
    <div
      className="flex items-center px-3 py-2"
      style={{
        gap: '6px',
        borderBottom: '1px solid var(--tg-theme-border-color, var(--color-border-default))',
        backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-dark))',
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
              fontFamily: "'Inter Display', system-ui, sans-serif",
              lineHeight: '16px',
              backgroundColor: isActive
                ? 'var(--tg-theme-button-color, var(--color-accent-amber))'
                : 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
              color: isActive
                ? 'var(--tg-theme-button-text-color, var(--color-text-white))'
                : 'var(--tg-theme-hint-color, var(--color-text-muted))',
              border: !isActive
                ? '1px solid var(--tg-theme-border-color, var(--color-border-white-subtle))'
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