import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

export function Card({
  children,
  className,
  notch,
}: {
  children: ReactNode;
  className?: string;
  notch?: number;
}) {
  return (
    <NotchedPanel
      corner="panel"
      notch={notch}
      className={className}
      contentClassName={cn("p-[18px]")}
    >
      {children}
    </NotchedPanel>
  );
}
