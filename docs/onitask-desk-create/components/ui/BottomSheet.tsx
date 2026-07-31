"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/NotchedPanel";

export function BottomSheet({
  open,
  onClose,
  children,
  /** Renders on top of another open BottomSheet (the date-range picker
   *  stacking on top of Create/Edit) — dims a bit more so the stacking
   *  order reads clearly, and sits at a higher z-index. */
  stacked = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  stacked?: boolean;
}) {
  // Telegram's hardware/gesture back action maps to Escape in a plain
  // browser preview — closing on it here is cheap insurance for that,
  // and costs nothing on devices where it never fires.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex flex-col justify-end",
        stacked ? "z-50" : "z-40",
        // Visible-but-inert when closed rather than unmounting outright:
        // keeps the slide-down close transition playable instead of the
        // panel just vanishing instantly.
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-scrim transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        className={cn(
          "relative w-full transition-transform duration-300 ease-out",
          open ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          // Reserves room for the device home indicator so the sheet's
          // own bottom padding (set by each screen's content) doesn't
          // end up flush against it — same safe-area pattern used on
          // the main page, just applied to the sheet's own base instead.
          paddingBottom:
            "calc(var(--tg-content-safe-bottom) + var(--tg-safe-area-bottom))",
        }}
      >
        <NotchedPanel
          corner="sheet"
          squareBottom
          fill="var(--color-bg)"
          borderWidth={1}
          contentClassName="max-h-[85vh] overflow-y-auto"
        >
          {children}
        </NotchedPanel>
      </div>
    </div>,
    document.body
  );
}
