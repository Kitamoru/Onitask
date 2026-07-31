import { cn } from "@/lib/cn";

export function CountBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  /** "success" — green pill for status labels like "Активный"; the
   *  translucent green fill was measured off the sprint mockups
   *  (roughly rgba(success, 0.12), not a flat solid). */
  tone?: "neutral" | "success";
}) {
  return (
    <span
      className={cn(
        "rounded-[10px] border px-3 py-1.5 text-[13px]",
        tone === "neutral" && "border-line text-text-muted",
        tone === "success" && "border-success bg-success/[0.12] text-success"
      )}
    >
      {children}
    </span>
  );
}
