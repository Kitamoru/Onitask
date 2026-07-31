import type { ReactNode } from 'react';

/**
 * Field — label + children wrapper for form fields.
 * Matches the desk-create pattern: label above the input.
 */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm leading-[1.125rem] tracking-tighter text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}