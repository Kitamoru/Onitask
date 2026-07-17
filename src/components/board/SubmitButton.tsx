'use client';

import React from 'react';

/**
 * Primary submit button matching Figma button-prim-s design (node 7:7369).
 * 
 * Figma spec:
 *   - height: 40px, full width
 *   - Background: #0A0A0A with gradient border
 *   - Text: Inter Display, Semi Bold, 14px, lineHeight: 18px, color: #202020
 *   - ref-bg-shape-inner overlay
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface SubmitButtonProps {
  /** Button text */
  children?: React.ReactNode;
  /** onClick handler */
  onClick?: () => void;
  /** Submit type for form integration */
  type?: 'button' | 'submit' | 'reset';
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Additional class names */
  className?: string;
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function SubmitButton({
  children = 'Создать доску',
  onClick,
  type = 'submit',
  disabled = false,
  loading = false,
  className = '',
}: SubmitButtonProps) {
  const isBusy = disabled || loading;

  return (
    <div className={`relative w-full ${className}`}>
      {/* Gradient background shape */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          padding: '1px',
        }}
        aria-hidden="true"
      />
      <button
        type={type}
        onClick={onClick}
        disabled={isBusy}
        aria-busy={loading}
        className="
          relative flex items-center justify-center w-full h-10
          rounded-md
          bg-accent-amber
          text-primary-dark
          font-semibold
          transition-colors duration-normal
          disabled:opacity-50 disabled:cursor-not-allowed
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber focus-visible:ring-offset-2 focus-visible:ring-offset-primary-dark
        "
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-body-md)',
          lineHeight: 'var(--text-body-md-line)',
          fontWeight: 'var(--font-weight-semibold)',
        }}
      >
        {loading ? (
          <>
            <span className="sr-only">Загрузка...</span>
            <SpinnerIcon />
          </>
        ) : (
          children
        )}
      </button>
    </div>
  );
}