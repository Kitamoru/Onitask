import type { ReactNode } from "react";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
