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
        stroke="#FAFAFA"
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
        stroke="#FAFAFA"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.83337 10H14.1667"
        stroke="#FAFAFA"
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
        className="absolute inset-0 pointer-events-none rounded-[4px]"
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
      <div className="flex items-center relative">
        {/* Minus button */}
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          aria-label="Уменьшить значение"
          className={`
            flex items-center justify-center w-10 h-10
            rounded-[4px]
            bg-surface
            transition-colors duration-150
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
          style={{ minWidth: '100px' }}
        >
          <span
            className="text-bg-light font-semibold whitespace-nowrap"
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '14px',
              lineHeight: '18px',
              fontWeight: '600',
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
            rounded-[4px]
            bg-surface
            transition-colors duration-150
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