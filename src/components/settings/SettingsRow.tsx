'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';

interface SettingsRowProps {
  label: string;
  value?: string;
  onClick?: () => void;
  /** Custom trailing icon — defaults to ChevronRight */
  trailingIcon?: ReactNode;
}

/**
 * Shared settings row — matches Figma node 65:14537 "settings".
 * Template EL-c7474eb0: row, padding 14px 12px, gap 6px, borderRadius 6px.
 * Renders as a button when onClick is provided, otherwise as a div.
 */
export function SettingsRow({
  label,
  value,
  onClick,
  trailingIcon,
}: SettingsRowProps) {
  const Interactive = onClick ? 'button' : 'div';

  return (
    <Interactive
      className="flex items-center w-full cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
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
        corner="field"
        notch={8}
        borderWidth={1.5}
        border="rgba(255, 255, 255, 0.15)"
        fill="var(--color-surface)"
        contentClassName="flex h-12 w-full items-center justify-between px-3 gap-2"
      >
        <span
          className="text-base font-medium leading-6 text-[#FAFAFA] truncate"
          style={{ fontFamily: 'var(--font-family-display)', fontSize: 16, fontWeight: 500 }}
        >
          {label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {value && (
            <span
              className="text-base leading-6 text-[#A1A1AA] whitespace-nowrap"
              style={{ fontFamily: 'var(--font-family-display)', fontSize: 16, fontWeight: 400 }}
            >
              {value}
            </span>
          )}
          {trailingIcon ?? (
            <ChevronRight className="w-5 h-5 text-text-secondary shrink-0" />
          )}
        </div>
      </NotchedPanel>
    </Interactive>
  );
}
