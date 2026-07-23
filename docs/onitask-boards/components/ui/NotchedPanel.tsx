import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { clipPathFor, type CornerStyle } from "@/lib/notch";

type NotchedPanelProps = {
  corner: CornerStyle;
  radius?: number;
  notch?: number;
  borderWidth?: number;
  /** Solid border color. Ignored if `borderGradient` is set. */
  border?: string;
  /** [from, to] — rendered as a 135deg linear-gradient border. */
  borderGradient?: [string, string];
  fill?: string;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
};

/**
 * Visual-only wrapper — does not render a semantic element. Put a real
 * <input>/<button> etc. inside as children; this just paints the
 * chamfered-corner background + border shape around it.
 *
 * Two stacked layers:
 *  - outer: sized to the full box, painted with the border color/gradient,
 *    clipped to the full notch.
 *  - inner: inset by `borderWidth` (via padding on the outer), painted
 *    with `fill`, clipped to a slightly smaller notch so the outer layer
 *    peeks out evenly on all edges — including along the diagonal cut.
 */
export function NotchedPanel({
  corner,
  radius = 6,
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
      className={cn("relative h-full", className)}
      style={{
        borderRadius: radius,
        clipPath: outerClip,
        background,
        padding: borderWidth,
      }}
    >
      <div
        className={cn("h-full w-full box-border", contentClassName)}
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
