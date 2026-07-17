'use client';

import React from 'react';

/**
 * TextInput component matching Figma input-field designs.
 * 
 * Figma spec (input-field-m, node 7:7692 / 7:8090):
 *   - padding: 14px 12px (m) or 10px 12px (s)
 *   - gap: 6px between icon and text
 *   - borderRadius: 6px (m) or 4px (s)
 *   - Background: transparent with gradient border via ref-bg-shape-inner
 *   - Placeholder text: Inter, Medium, 16px (m) or 14px (s), color: #8B8B8B, opacity: 0.5
 *   - Supports leading/trailing icons
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface TextInputProps {
  /** Input placeholder text */
  placeholder?: string;
  /** Current input value */
  value?: string;
  /** Optional onChange handler */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Optional id for label association */
  id?: string;
  /** Optional label text */
  label?: string;
  /** Size variant: 'md' for large (16px), 'sm' for small (14px) */
  size?: 'md' | 'sm';
  /** Show leading icon */
  showLeadingIcon?: boolean;
  /** Show trailing icon */
  showTrailingIcon?: boolean;
  /** Leading icon element */
  leadingIcon?: React.ReactNode;
  /** Trailing icon element */
  trailingIcon?: React.ReactNode;
  /** Input type */
  type?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Error message */
  error?: string;
  /** Additional class names */
  className?: string;
  /** ARIA label */
  'aria-label'?: string;
}

export function TextInput({
  placeholder,
  value,
  onChange,
  id,
  label,
  size = 'md',
  showLeadingIcon,
  showTrailingIcon,
  leadingIcon,
  trailingIcon,
  type = 'text',
  disabled = false,
  error,
  className = '',
  'aria-label': ariaLabel,
}: TextInputProps) {
  const isMd = size === 'md';
  const fontSize = isMd ? 'var(--text-body-lg)' : 'var(--text-body-md)';
  const lineHeight = isMd ? 'var(--text-body-lg-line)' : 'var(--text-body-md-line)';
  const letterSpacing = isMd ? 'var(--letter-spacing-tight)' : 'var(--letter-spacing-tighter)';
  const fontWeight = isMd ? 'var(--font-weight-medium)' : 'var(--font-weight-regular)';
  const padding = isMd ? 'var(--spacing-3.5) var(--spacing-3)' : 'var(--spacing-2.5) var(--spacing-3)';
  const borderRadius = isMd ? 'var(--radius-md)' : 'var(--radius-sm)';

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="block mb-1.5"
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          {label}
        </label>
      )}
      <div className="relative w-full">
        {/* Gradient background shape */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
            borderRadius,
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            maskComposite: 'exclude',
            WebkitMaskComposite: 'xor',
            padding: '1px',
          }}
          aria-hidden="true"
        />
        <div
          className="flex items-center w-full"
          style={{ padding }}
        >
          {/* Leading icon */}
          {showLeadingIcon && leadingIcon && (
            <span className="shrink-0 mr-1.5">{leadingIcon}</span>
          )}
          {/* Input field */}
          <input
            id={id}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={ariaLabel || placeholder}
            aria-invalid={!!error}
           className="flex-1 min-w-0 bg-transparent text-primary outline-none disabled:opacity-50 placeholder:text-muted placeholder:opacity-50"
           style={{
             fontFamily: 'var(--font-family-base)',
             fontSize,
             lineHeight,
             letterSpacing,
             fontWeight,
             color: 'var(--color-text-primary)',
           }}
          />
          {/* Trailing icon */}
          {showTrailingIcon && trailingIcon && (
            <span className="shrink-0 ml-1.5">{trailingIcon}</span>
          )}
        </div>
      </div>
      {error && (
        <p
          className="mt-1 text-xs"
          style={{ color: 'var(--color-accent-amber)' }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}