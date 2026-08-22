'use client';

import { ChevronRight } from 'lucide-react';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';

interface SettingsRowProps {
  label: string;
  value?: string;
  onClick?: () => void;
}

/**
 * Shared settings row — uses NotchedPanel for correct chamfered-corner borders.
 * Renders as a button when onClick is provided, otherwise as a div.
 */
export function SettingsRow({ label, value, onClick }: SettingsRowProps) {
  const Interactive = onClick ? 'button' : 'div';

  return (
    <Interactive
      className="flex items-center justify-between w-full cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={value ? `${label}: ${value}` : label}
    >
      <NotchedPanel
        corner="action"
        notch={8}
        borderWidth={1.5}
        border="rgba(255, 255, 255, 0.15)"
        fill="var(--color-surface)"
        contentClassName="flex h-10 w-full items-center justify-between px-3"
      >
        <span
          className="text-base font-medium leading-5 text-white truncate"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {value && (
            <span
              className="text-base font-medium leading-5 text-white whitespace-nowrap"
              style={{ fontFamily: 'var(--font-family-display)' }}
            >
              {value}
            </span>
          )}
          <ChevronRight className="h-5 w-5 text-text-secondary shrink-0" />
        </div>
      </NotchedPanel>
    </Interactive>
  );
}
