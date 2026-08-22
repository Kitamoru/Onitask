// NotchButton – custom button with notch style (clip‑path, rounded corners, border)
import { type ButtonHTMLAttributes } from "react";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import { cn } from "@/lib/cn";

type NotchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  /** optional custom styles */
  className?: string;
};

export function NotchButton({ label, onClick, className, ...props }: NotchButtonProps) {
  // Using the existing NotchedPanel which already provides the notch shape.
  // Additional clip‑path can be added via CSS if needed.
  const customStyle: React.CSSProperties = {
    // Example clip‑path for a notch (can be adjusted as design requires)
    clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
  };

  return (
    <button
      onClick={onClick}
      className={cn("block h-10 w-full", className)}
      style={customStyle}
      {...props}
    >
      <NotchedPanel
        corner="action"
        radius={4}
        notch={8}
        borderWidth={1.5}
        borderGradient={["var(--color-grad-add-from)", "var(--color-grad-add-to)"]}
        fill="var(--color-surface)"
        contentClassName="font-display font-medium"
        className="h-full"
      >
        {label}
      </NotchedPanel>
    </button>
  );
}
