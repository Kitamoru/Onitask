"use client";

import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import type { CornerStyle } from "@/lib/notch";
import { useAutosizeTextarea } from "@/hooks/useAutosizeTextarea";

type TextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  corner?: Extract<CornerStyle, "panel" | "field">;
  value: string;
  onChange: (value: string) => void;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    { className, corner = "panel", value, onChange, ...props },
    forwardedRef
  ) {
    const autosizeRef = useAutosizeTextarea(value);

    const fieldNotch = corner === "field" ? 8 : undefined;
    return (
      <NotchedPanel corner={corner} notch={fieldNotch} fill="var(--color-surface)">
        <textarea
          ref={(node) => {
            autosizeRef.current = node;
            if (typeof forwardedRef === "function") forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={1}
          {...props}
          className={cn(
            // py-3 (12px) + text-base's 24px line-height = 48px for an
            // empty single line — matches the old single-line input's
            // height exactly, so the empty state looks identical to
            // before. From there it grows with content instead of
            // scrolling sideways.
            "block min-h-[48px] w-full resize-none overflow-y-auto bg-transparent px-4 py-3",
            // Caps visible growth at 40% of viewport height, then
            // scrolls internally — a deliberate judgment call, not
            // something explicitly asked for: 1200 characters can run
            // to 15-20 lines, and letting the box grow fully unbounded
            // would push "Создать доску" way down the page. 40vh is
            // still generous for proofreading a full paste. To make it
            // truly unbounded instead, just delete the max-h-[40vh]
            // and overflow-y-auto below.
            "max-h-[40vh]",
            // 16px (text-base) is deliberate, not a scale choice —
            // anything smaller triggers iOS Safari/Telegram's
            // auto-zoom-on-focus, which then fights the TWA
            // keyboard-resize layout.
            "text-base leading-6 text-text placeholder:text-text-faint",
            "outline-none",
            className
          )}
        />
      </NotchedPanel>
    );
  }
);