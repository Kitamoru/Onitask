import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import type { CornerStyle } from "@/lib/notch";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /**
   * "panel" — top-level standalone field directly under a section
   * header (Название доски, @desk, Краткое описание): cut top-left +
   * bottom-right, like a card.
   * "field" — nested inside a Card (SP-hour rows, Выберите файл,
   * Название ресурса, Ссылка): cut bottom-right only.
   */
  corner?: Extract<CornerStyle, "panel" | "field">;
  /**
   * Static, non-editable text rendered before the value — e.g. "@" for
   * the desk-handle field. Not part of the input's own value/maxLength;
   * the caller owns stripping/validating what the user types after it.
   */
  prefix?: string;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, corner = "field", prefix, ...props }, ref) {
    // Always a flex row, prefix or not — keeps a single layout path
    // instead of branching the DOM shape, and costs nothing visually
    // when there's no prefix (input still fills the row edge-to-edge).
    const heightClass = corner === "panel" ? "h-12" : "h-10";
    const fieldNotch = corner === "field" ? 8 : undefined;
    return (
      <NotchedPanel corner={corner} notch={fieldNotch} fill="var(--color-surface)">
        <div className={cn("flex items-center", heightClass)}>
          {prefix && (
            <span
              className="select-none pl-4 text-base text-text-faint"
              aria-hidden="true"
            >
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            {...props}
            className={cn(
              "h-full w-full bg-transparent",
              prefix ? "pl-1 pr-4" : "px-4",
              // 16px (text-base) is deliberate, not a scale choice —
              // anything smaller triggers iOS Safari/Telegram's
              // auto-zoom-on-focus, which then fights the TWA
              // keyboard-resize layout.
              "text-base text-text placeholder:text-text-faint",
              "outline-none",
              className
            )}
          />
        </div>
      </NotchedPanel>
    );
  }
);