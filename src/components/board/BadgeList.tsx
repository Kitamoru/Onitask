'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Colleagues list section with badge items and "Add colleague" button.
 * 
 * Figma spec (node 337:29243):
 *   - Container with "Список коллег" text + badge showing count
 *   - Secondary button: "Добавить коллегу" (40px height)
 *   - Outer gradient background shape
 */
export interface Colleague {
  id: string;
  name: string;
  avatar?: string;
}

export interface BadgeListProps {
  /** List of colleagues */
  colleagues: Colleague[];
  /** Add colleague button onClick handler */
  onAddColleagues: () => void;
  /** Disabled state for the add button */
  addDisabled?: boolean;
  /** Additional class names */
  className?: string;
}

export function BadgeList({
  colleagues,
  onAddColleagues,
  addDisabled = false,
  className = '',
}: BadgeListProps) {
  return (
    <div className={`relative ${className}`}>
      {/* Gradient outer background shape */}
      <div
        className="absolute inset-0 pointer-events-none rounded-card"
        style={{
          backgroundImage:
            'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          padding: '1px',
        }}
        aria-hidden="true"
      />
      <div className="p-3 relative">
        {/* Colleagues header row */}
        <div className="flex items-center gap-1 mb-3 w-full max-w-[334px]">
          <span
            className="text-bg-light truncate"
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '16px',
              lineHeight: '20px',
              fontWeight: '500',
              letterSpacing: '-0.0313em',
            }}
          >
            Список коллег
          </span>
          <Badge>{colleagues.length} коллег</Badge>
        </div>

        {/* Add colleague button */}
        <button
          type="button"
          onClick={onAddColleagues}
          disabled={addDisabled}
          className="
            flex items-center justify-center w-full h-10
            rounded-md
            bg-surface/50
            border border-white/10
            text-bg-light
            font-semibold
            transition-colors duration-150
            hover:bg-surface/70
            active:bg-surface/40
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          "
          style={{
            fontFamily: "'Inter Display', system-ui, sans-serif",
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: '600',
          }}
          aria-label="Добавить коллегу"
        >
          Добавить коллегу
        </button>
      </div>
    </div>
  );
}