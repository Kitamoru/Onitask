'use client';

import * as React from 'react';

export interface BadgeProps {
  /** Badge content */
  children: React.ReactNode;
  /** Optional icon */
  icon?: React.ReactNode;
  /** Custom class names */
  className?: string;
}

/**
 * Badge component matching Figma design (node 17:8819 / badge).
 * 
 * Figma spec:
 *   - padding: 4px
 *   - justifyContent/alignItems: center
 *   - gap: 8px
 *   - Background: rgba(128, 128, 128, 0.2)
 *   - Stroke: #808080, 1px
 *   - borderRadius: 4px
 *   - Text: Inter Display, Medium, 12px, lineHeight: 14px
 *   - Text color: #808080
 *   - letterSpacing: -0.0313em
 */
export function Badge({ children, icon, className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center justify-center
        px-1 py-0.5
        rounded-[4px]
        bg-[rgba(128,128,128,0.2)]
        border border-[#808080]
        text-[#808080]
        font-medium shrink-0
        ${className}
      `}
      style={{
        fontFamily: "'Inter Display', system-ui, sans-serif",
        fontSize: '12px',
        lineHeight: '14px',
        letterSpacing: '-0.0313em',
      }}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}