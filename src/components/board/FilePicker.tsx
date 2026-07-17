'use client';

import React from 'react';

/**
 * File picker component for board additional materials.
 * 
 * Figma spec (node 338:30067):
 *   - input-field-s with trailing upload icon
 *   - padding: 10px 12px
 *   - Text: "Выберите файл"
 *   - Helper text: "до 10 документов, до 5мегабайт в сумме, формат .md"
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface FilePickerProps {
  /** Selected file */
  file?: File | null;
  /** onChange handler */
  onChange: (file: File | null) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Error message */
  error?: string;
  /** Additional class names */
  className?: string;
}

function UploadIcon() {
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
        d="M10 14.1667V5.83333"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.66675 7.5L10 4.16667L13.3334 7.5"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.8334 10V14.1667C15.8334 14.6087 15.658 15.0287 15.3455 15.3412C15.033 15.6537 14.613 15.8334 14.1717 15.8334H5.83341C5.39138 15.8334 4.97133 15.6537 4.65884 15.3412C4.34635 15.0287 4.16675 14.6087 4.16675 14.1667V10"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FilePicker({
  file,
  onChange,
  disabled = false,
  error,
  className = '',
}: FilePickerProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    onChange(selectedFile);
  };

  return (
    <div className={`w-full ${className}`}>
      <div className="relative w-full mb-2">
        {/* Gradient background shape */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
            borderRadius: 'var(--radius-sm)',
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            padding: '1px',
          }}
          aria-hidden="true"
        />
        <div className="flex items-center w-full" style={{ padding: 'var(--spacing-2.5) var(--spacing-3)' }}>
          {/* File name or placeholder */}
          <span
            className={`flex-1 min-w-0 truncate ${file ? 'text-primary' : 'text-muted opacity-50'}`}
            style={{
              fontFamily: 'var(--font-family-base)',
              fontSize: 'var(--text-body-md)',
              lineHeight: 'var(--text-body-md-line)',
              letterSpacing: 'var(--letter-spacing-tighter)',
              fontWeight: 'var(--font-weight-medium)',
            }}
          >
            {file ? file.name : 'Выберите файл'}
          </span>
          {/* Upload icon */}
          <span className="shrink-0 ml-1.5">
            <UploadIcon />
          </span>
          {/* Hidden file input */}
          <input
            type="file"
            accept=".md"
            onChange={handleChange}
            disabled={disabled}
            className="sr-only"
            aria-label="Выберите файл"
          />
        </div>
        {/* Clickable overlay */}
        <div
          className="absolute inset-0 cursor-pointer"
          style={{ zIndex: 1 }}
          role="button"
          tabIndex={0}
          aria-label="Выберите файл"
          onClick={() => {
            // Find the hidden file input inside the same parent container and trigger click
            const container = (document.activeElement?.parentElement?.parentElement) as HTMLElement | null;
            const input = container?.querySelector('input[type="file"]') as HTMLInputElement | null;
            input?.click();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const container = (e.currentTarget.parentElement) as HTMLElement | null;
              const input = container?.querySelector('input[type="file"]') as HTMLInputElement | null;
              input?.click();
            }
          }}
        />
      </div>
      {/* Helper text */}
      <p
        className="text-muted"
        style={{
          fontFamily: 'var(--font-family-base)',
          fontSize: 'var(--text-body-sm)',
          lineHeight: 'var(--text-body-sm-line)',
          letterSpacing: 'var(--letter-spacing-tightest)',
          fontWeight: 'var(--font-weight-regular)',
        }}
      >
        до 10 документов, до 5 МБ в сумме, формат .md
      </p>
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