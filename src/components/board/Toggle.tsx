'use client';

import React from 'react';

/**
 * Toggle component matching Figma toggle design (node 22:5993 / 22:5997).
 * 
 * Figma spec:
 *   - Container: 48x24px, borderRadius: 4px
 *   - Background: #101010 with gradient border
 *   - Nail: 24px width, rounded 2px, bg: #FAFAFA
 *   - Active state: nail slides to right
 *   - Inactive state: nail stays on left
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface ToggleProps {
  /** Whether the toggle is checked/on */
  checked: boolean;
  /** onChange handler */
  onChange: (checked: boolean) => void;
  /** Disabled state */
  disabled?: boolean;
  /** ARIA label */
  'aria-label'?: string;
  /** Optional id */
  id?: string;
  /** Additional class names */
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
  id,
  className = '',
}: ToggleProps) {
  const handleChange = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleChange();
    }
  };

  return (
    <div className={`shrink-0 ${className}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={checked}
        role="switch"
        className="sr-only"
      />
      <button
        type="button"
        onClick={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-checked={checked}
        role="switch"
        aria-label={ariaLabel}
        tabIndex={disabled ? -1 : 0}
        className={`
          relative flex items-center w-[var(--size-toggle-track)] h-[var(--size-toggle-track-height)]
          rounded-card
          bg-transparent
          overflow-hidden
          cursor-pointer
          transition-all duration-normal
          disabled:opacity-50 disabled:cursor-not-allowed
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber focus-visible:ring-offset-1 focus-visible:ring-offset-primary-dark
        `}
        style={{
          backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
          backgroundOrigin: 'border-box',
          backgroundClip: 'content-box, border-box',
        }}
      >
        {/* Gradient border overlay */}
        <div
          className="absolute inset-0 rounded-card"
          style={{
            border: '1px solid transparent',
            backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
          aria-hidden="true"
        />
        {/* Nail shape */}
        <div
          className="h-full bg-bg-light rounded-sm transition-transform duration-200 ease-in-out"
          style={{
            width: 'var(--size-toggle-nail)',
            transform: checked ? 'translateX(24px)' : 'translateX(0)',
          }}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}