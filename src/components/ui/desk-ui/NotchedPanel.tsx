import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { clipPathFor, type CornerStyle } from "@/lib/notch";

type NotchedPanelProps = {
  corner: CornerStyle;
  radius?: number;
  notch?: number;
  borderWidth?: number;
  border?: string;
  borderGradient?: [string, string];
  fill?: string;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
};

export function NotchedPanel({
  corner,
  radius = 16,
  notch = 16,
  borderWidth = 1,
  border,
  borderGradient,
  fill = "var(--color-surface)",
  className,
  contentClassName,
  children,
}: NotchedPanelProps) {
  const outerClip = clipPathFor(corner, notch);
  const innerNotch = Math.max(notch - borderWidth, 0);
  const innerClip = clipPathFor(corner, innerNotch);
  const innerRadius = Math.max(radius - borderWidth, 0);

  const background = borderGradient
    ? `linear-gradient(135deg, ${borderGradient[0]}, ${borderGradient[1]})`
    : border ?? "var(--color-line)";

  return (
    <div
      className={cn("relative inline-flex", className)} // ← важно: inline-flex + flex
      style={{
        borderRadius: radius,
        clipPath: outerClip,
        background,
        padding: borderWidth,
      }}
    >
      <div
        className={cn(
          "flex-1 w-full",           // ← flex-1 вместо h-full
          contentClassName
        )}
        style={{
          borderRadius: innerRadius,
          clipPath: innerClip,
          background: fill,
        }}
      >
        {children}
      </div>
    </div>
  );
}
