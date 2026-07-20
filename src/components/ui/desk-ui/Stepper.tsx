"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

export function Stepper({
  value,
  unitLabel,
  min = 1,
  max = 30,
  onChange,
  borderGradient,
}: {
  value: number;
  unitLabel: (n: number) => string;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  borderGradient: [string, string];
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <NotchedPanel
      corner="action"
      borderWidth={1.5}
      borderGradient={borderGradient}
      fill="var(--color-surface)"
      contentClassName="flex h-[52px] items-center justify-between px-2"
    >
      <StepperButton onClick={dec} disabled={value <= min} label="Уменьшить">
        <Minus className="h-4 w-4" />
      </StepperButton>

      <span className="text-[15px] font-semibold text-text tabular-nums">
        {unitLabel(value)}
      </span>

      <StepperButton onClick={inc} disabled={value >= max} label="Увеличить">
        <Plus className="h-4 w-4" />
      </StepperButton>
    </NotchedPanel>
  );
}

function StepperButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-text transition-opacity",
        disabled && "opacity-30"
      )}
    >
      {children}
    </button>
  );
}