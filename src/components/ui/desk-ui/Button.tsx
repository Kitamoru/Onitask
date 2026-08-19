import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import type { CornerStyle } from "@/lib/notch";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "outline" | "solid";
  /** Additive: defaults to "action" so existing call sites are unaffected. /boards uses "field". */
  corner?: CornerStyle;
  /** Override the solid fill color (e.g. "#EF4444" for delete buttons). */
  fill?: string;
  /** Override the text color for solid buttons. */
  textColor?: string;
};

export function Button({
  variant = "outline",
  corner = "action",
  className,
  children,
  disabled,
  fill,
  textColor,
  style: inlineStyle,
  ...props
}: ButtonProps) {
  const resolvedFill =
    variant === "outline" ? "var(--color-surface)" : (fill ?? "var(--color-accent)");

  const resolvedContentClassName = cn(
    "flex h-full w-full items-center justify-center gap-2 text-[15px] font-semibold",
    variant === "outline" && "text-text",
    variant === "solid" && !textColor && "text-accent-ink"
  );

  const resolvedStyle: React.CSSProperties = {
    ...(inlineStyle || {}),
    ...(textColor ? { color: textColor } : {}),
  };

  return (
    <button
      {...props}
      disabled={disabled}
      className={cn(
        "block h-10 w-full appearance-none border-0 bg-transparent p-0",
        disabled && "opacity-40",
        className
      )}
      style={resolvedStyle}
    >
      <NotchedPanel
        corner={corner}
        radius={corner === "field" ? 4 : undefined}
        notch={corner === "field" ? 16 : 8}
        borderWidth={variant === "outline" ? 1.5 : 0}
        borderGradient={
          variant === "outline"
            ? ["var(--color-grad-add-from)", "var(--color-grad-add-to)"]
            : undefined
        }
        fill={resolvedFill}
        contentClassName={resolvedContentClassName}
        className="h-full"
      >
        {children}
      </NotchedPanel>
    </button>
  );
}
