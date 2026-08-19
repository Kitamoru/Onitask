'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * AutoResizeTextarea — grows height to fit content automatically.
 * Uses the "collapse to auto, read scrollHeight" technique.
 */
interface AutoResizeTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  /** Current textarea value (string or anything coerced to string) */
  value?: string | number | null | undefined;
}

export function AutoResizeTextarea({
  value = '',
  onChange,
  className,
  style,
  ...props
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first so scrollHeight reflects the true content height
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      style={{
        overflowY: 'hidden',
        boxSizing: 'border-box',
        ...style,
      }}
      value={String(value ?? '')}
      onChange={(e) => onChange?.(e)}
      {...props}
    />
  );
}