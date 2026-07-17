'use client';

import React from 'react';

/**
 * TextArea component matching Figma text-area-m design (node 83:17453 / 83:17454).
 * 
 * Figma spec:
 *   - padding: 14px 12px
 *   - gap: 6px between icon and text
 *   - borderRadius: 6px
 *   - Placeholder text: Inter, Medium, 16px, color: #8B8B8B, opacity: 0.5
 *   - Supports leading/trailing icons
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface TextAreaProps {
  /** Text area placeholder text */
  placeholder?: string;
  /** Current text value */
  value?: string;
  /** Optional onChange handler */
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Optional id for label association */
  id?: string;
  /** Optional label text */
  label?: string;
  /** Number of rows */
  rows?: number;
  /** Maximum length of text */
  maxLength?: number;
  /** Disabled state */
  disabled?: boolean;
  /** Error message */
  error?: string;
  /** Additional class names */
  className?: string;
  /** ARIA label */
  'aria-label'?: string;
}

export function TextArea({
  placeholder,
  value,
  onChange,
  id,
  label,
  rows = 3,
  maxLength,
  disabled = false,
  error,
  className = '',
  'aria-label': ariaLabel,
}: TextAreaProps) {
  const charCount = (value?.length ?? 0);
  const isOverLimit = maxLength !== undefined && charCount > maxLength;

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
            borderRadius: 'var(--radius-md)',
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            padding: '1px',
          }}
          aria-hidden="true"
        />
        <textarea
          id={id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          aria-label={ariaLabel || placeholder}
          aria-invalid={!!error}
          className="
            w-full p-3 bg-transparent text-primary outline-none resize-none
            disabled:opacity-50
            focus-visible:ring-2 focus-visible:ring-accent-amber rounded-md
            placeholder:text-muted placeholder:opacity-50
          "
          style={{
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-lg)',
            lineHeight: 'var(--text-body-lg-line)',
            letterSpacing: 'var(--letter-spacing-tight)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>
      {/* Character counter when maxLength is set */}
      {maxLength !== undefined && (
        <p
          className="mt-1 text-xs text-right"
          style={{
            color: isOverLimit ? 'var(--color-error)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: 'var(--text-body-sm-line)',
          }}
          role="status"
        >
          {maxLength - charCount} символов осталось
        </p>
      )}
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