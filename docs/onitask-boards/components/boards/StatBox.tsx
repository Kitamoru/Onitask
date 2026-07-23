import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/NotchedPanel";

/**
 * Small container: radius 4px, bottom-right chamfer 8px.
 * Used both for the top-level summary tiles (Люди / Процессы / Эскалации)
 * and the 4-up pill row inside each BoardCard — same shape, two size
 * presets via `variant` (summary tiles run a touch taller/larger type).
 */
type StatBoxProps = {
  label: string;
  value: React.ReactNode;
  variant?: "summary" | "pill";
  tone?: "default" | "danger";
  className?: string;
};

export function StatBox({
  label,
  value,
  variant = "summary",
  tone = "default",
  className,
}: StatBoxProps) {
  return (
    <NotchedPanel
      corner="field"
      radius={4}
      notch={8}
      className={cn("flex-1", className)}
      contentClassName={cn(
        "flex flex-col",
        variant === "summary"
          ? "gap-1 px-3.5 py-[9px]"
          : "gap-[3px] py-[7px] pl-3 pr-1"
      )}
    >
      <span
        className={cn(
          "leading-tight text-text-muted",
          variant === "summary" ? "text-[13px]" : "text-[11.5px] leading-[1.1]"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-bold leading-none",
          variant === "summary" ? "text-2xl" : "text-xl",
          tone === "danger" ? "text-danger" : "text-text"
        )}
      >
        {value}
      </span>
    </NotchedPanel>
  );
}
