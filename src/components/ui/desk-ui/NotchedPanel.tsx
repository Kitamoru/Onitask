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
      className={cn("relative", className)}   // ← вернули только relative
      style={{
        borderRadius: radius,
        clipPath: outerClip,
        background,
        padding: borderWidth,
      }}
    >
      <div
        className={cn(
          "h-full w-full min-h-full",   // ← добавили min-h-full
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
