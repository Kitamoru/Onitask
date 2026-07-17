'use client';

import React from 'react';

/**
 * Counter component matching Figma counter design (node 424:32469).
 * 
 * Figma spec:
 *   - Horizontal row with minus button, label, plus button
 *   - Each button: 40x40px iconbutton-sec-s
 *   - Label: Inter Display, Semi Bold, 14px, lineHeight: 18px
 *   - Background: gradient border shape
 *   - Icons: outline/minus and outline/plus
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface CounterProps {
  /** Current value */
  value: number;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Label text (e.g., "1 день", "3 дня") */
  label: string;
  /** onChange handler with new value */
  onChange: (value: number) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
}

function MinusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5.83337 10H14.1667"
        stroke="var(--color-text-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M10 5.83337V14.1667"
        stroke="var(--color-text-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.83337 10H14.1667"
        stroke="var(--color-text-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Counter({
  value,
  min = 0,
  max = 99,
  step = 1,
  label,
  onChange,
  disabled = false,
  className = '',
}: CounterProps) {
  const handleDecrement = () => {
    if (!disabled && value > min) {
      onChange(Math.max(min, value - step));
    }
  };

  const handleIncrement = () => {
    if (!disabled && value < max) {
      onChange(Math.min(max, value + step));
    }
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* Gradient background shape */}
      <div
        className="absolute inset-0 pointer-events-none rounded-sm"
        style={{
          backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          padding: '1px',
        }}
        aria-hidden="true"
      />
      <div className="flex items-center relative">
        {/* Minus button */}
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          aria-label="Уменьшить значение"
          className={`
            flex items-center justify-center w-10 h-10
            rounded-sm
            bg-surface
            transition-colors duration-fast
            hover:bg-surface/80
            active:bg-surface/60
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          `}
        >
          <MinusIcon />
        </button>

        {/* Value label container */}
        <div
          className="flex items-center justify-center px-4 h-10"
          style={{ minWidth: '6.25rem' }}
        >
          <span
            className="text-primary font-semibold whitespace-nowrap"
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              lineHeight: 'var(--text-body-md-line)',
              fontWeight: 'var(--font-weight-semibold)',
            }}
          >
            {label}
          </span>
        </div>

        {/* Plus button */}
        <button
          type="button"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
          aria-label="Увеличить значение"
          className={`
            flex items-center justify-center w-10 h-10
            rounded-sm
            bg-surface
            transition-colors duration-fast
            hover:bg-surface/80
            active:bg-surface/60
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          `}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}