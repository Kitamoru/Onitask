export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[10px] border border-line px-3 py-1.5 text-[13px] text-text-muted">
      {children}
    </span>
  );
}