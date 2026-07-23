import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/NotchedPanel";
import type { CornerStyle } from "@/lib/notch";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "outline" | "solid";
  /**
   * NEW — additive, defaults to the existing "action" (TR+BL cut) so every
   * current call site is unaffected. /boards uses "field" (BR-only cut):
   * on that screen every container, big or small, shares the single
   * bottom-right-chamfer language — see components/boards/*.
   */
  corner?: CornerStyle;
};

export function Button({
  variant = "outline",
  corner = "action",
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={cn(
        // Measured off the reference: buttons run a compact 40px, not
        // the 52px used by standalone inputs — an earlier pass matched
        // them to the input height by mistake.
        "block h-10 w-full appearance-none border-0 bg-transparent p-0",
        disabled && "opacity-40",
        className
      )}
    >
      <NotchedPanel
        corner={corner}
        radius={corner === "field" ? 4 : undefined}
        notch={corner === "field" ? 16 : undefined}
        borderWidth={variant === "outline" ? 1.5 : 0}
        borderGradient={
          variant === "outline"
            ? ["var(--color-grad-add-from)", "var(--color-grad-add-to)"]
            : undefined
        }
        fill={variant === "outline" ? "var(--color-surface)" : "var(--color-accent)"}
        contentClassName={cn(
          "flex h-full w-full items-center justify-center gap-2 text-[15px] font-semibold",
          variant === "outline" && "text-text",
          variant === "solid" && "text-accent-ink"
        )}
      >
        {children}
      </NotchedPanel>
    </button>
  );
}
