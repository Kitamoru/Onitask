import { cn } from '@/lib/cn';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';

/**
 * StatBox — stat display block using NotchedPanel.
 * Shows a label and a value, with optional success tone (green).
 */
export function StatBox({
  label,
  value,
  valueTone = 'default',
}: {
  label: string;
  value: string;
  valueTone?: 'default' | 'success';
}) {
  return (
    <NotchedPanel
      corner="field"
      fill="var(--color-surface)"
      contentClassName="flex flex-col gap-1 px-4 py-3"
    >
      <span className="text-[13px] text-text-muted">{label}</span>
      <span
        className={cn(
          'text-[17px] font-semibold',
          valueTone === 'success' ? 'text-success' : 'text-text',
        )}
      >
        {value}
      </span>
    </NotchedPanel>
  );
}