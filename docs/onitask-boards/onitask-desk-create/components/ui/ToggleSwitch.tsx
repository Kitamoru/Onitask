"use client";

import { cn } from "@/lib/cn";

/**
 * The reference does NOT use an iOS-style pill switch: the track is a
 * moderately-rounded rectangle (not a full stadium shape) and the knob
 * is a rounded square, not a circle. Measured off the screenshot at
 * roughly 60x24px (2x) -> ~30x12 (1x); rounded here to clean 52x28.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-[52px] shrink-0 rounded-[10px] border border-line transition-colors duration-200",
        checked ? "bg-accent" : "bg-toggle-track-off"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[22px] -translate-y-1/2 rounded-[6px] bg-toggle-knob shadow-sm transition-transform duration-200",
          checked ? "translate-x-[26px]" : "translate-x-1"
        )}
      />
    </button>
  );
}
