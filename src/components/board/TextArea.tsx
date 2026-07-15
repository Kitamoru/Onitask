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
  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="block mb-1.5"
          style={{
            fontFamily: "'Inter Display', system-ui, sans-serif",
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: '500',
            color: '#FAFAFA',
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
            backgroundImage:
              'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
            borderRadius: '6px',
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
            w-full p-3 bg-transparent text-bg-light outline-none resize-none
            disabled:opacity-50
            focus-visible:ring-2 focus-visible:ring-accent-amber rounded-[6px]
          "
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: '16px',
            lineHeight: '20px',
            letterSpacing: '-0.0313em',
            fontWeight: '500',
            color: '#FAFAFA',
          }}
        />
      </div>
      {/* Character counter when maxLength is set */}
      {maxLength !== undefined && (
        <p
          className="mt-1 text-xs text-right"
          style={{
            color: value.length > maxLength ? '#EF4444' : '#8B8B8B',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: '12px',
            lineHeight: '16px',
          }}
          role="status"
        >
          {maxLength - value.length} символов осталось
        </p>
      )}
      {error && (
        <p
          className="mt-1 text-xs"
          style={{ color: '#F59E0B' }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}