import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import type { CornerStyle } from "@/lib/notch";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  corner?: Extract<CornerStyle, "panel" | "field">;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, corner = "field", ...props }, ref) {
    return (
      <NotchedPanel corner={corner} fill="var(--color-surface)">
        <input
          ref={ref}
          {...props}
          className={cn(
            "h-[52px] w-full bg-transparent px-4",
            "text-base text-text placeholder:text-text-faint",
            "outline-none",
            className
          )}
        />
      </NotchedPanel>
    );
  }
);