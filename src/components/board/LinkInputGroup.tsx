'use client';

import React from 'react';
import { TextInput } from './TextInput';

/**
 * LinkInputGroup — renders only the two input fields and the add button.
 * The parent component (BoardForm) handles the toggle and header.
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */
export interface LinkInputGroupProps {
  /** Resource name value */
  resourceName: string;
  /** Resource name onChange */
  onResourceNameChange: (value: string) => void;
  /** URL value */
  url: string;
  /** URL onChange */
  onUrlChange: (value: string) => void;
  /** Add link button onClick handler */
  onAddLink: () => void;
  /** Disabled state for the add button */
  addDisabled?: boolean;
  /** Additional class names */
  className?: string;
}

export function LinkInputGroup({
  resourceName,
  onResourceNameChange,
  url,
  onUrlChange,
  onAddLink,
  addDisabled = false,
  className = '',
}: LinkInputGroupProps) {
  return (
    <div className={`relative ${className}`}>
      {/* Input fields */}
        <div className="space-y-2 mb-3">
          <TextInput
            placeholder="Название ресурса"
            value={resourceName}
            onChange={(e) => onResourceNameChange(e.target.value)}
            size="sm"
          />
          <TextInput
            placeholder="Ссылка"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            size="sm"
            type="url"
          />
        </div>

      {/* Add link button */}
        <button
          type="button"
          onClick={onAddLink}
          disabled={addDisabled}
          className="
            flex items-center justify-center w-full h-10
            rounded-md
            bg-surface/50
            border border-border-white-subtle
            text-primary
            font-semibold
            transition-colors duration-fast
            hover:bg-surface/70
            active:bg-surface/40
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          "
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            lineHeight: 'var(--text-body-md-line)',
            fontWeight: 'var(--font-weight-semibold)',
          }}
          aria-label="Добавить ссылку"
      >
        Добавить ссылку
      </button>
    </div>
  );
}