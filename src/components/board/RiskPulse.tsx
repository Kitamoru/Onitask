"use client";

import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

/**
 * RiskPulse component — displays aggregated risk metrics across all boards.
 *
 * Uses NotchedPanel with corner="field", radius=4, notch=8 for summary tiles.
 */

export interface RiskPulseData {
  people: number;
  processes: number;
  escalations: number;
}

export interface RiskPulseProps {
  data: RiskPulseData;
  onSprintClick?: () => void;
}

const pulseCards = [
  { label: "Люди", key: "people" as const },
  { label: "Процессы", key: "processes" as const },
  { label: "Эскалации", key: "escalations" as const },
];

export function RiskPulse({ data, onSprintClick }: RiskPulseProps) {
  return (
    <div className="flex flex-col w-full gap-4">
      {/* Section title */}
      <p
        style={{
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--text-body-md)",
          lineHeight: "var(--text-body-md-line)",
          fontWeight: "var(--font-weight-medium)",
          textAlign: "left" as const,
          color: "var(--color-text-muted)",
        }}
      >
        Сводка по всем моим доскам
      </p>

      {/* Summary cards grid */}
      <div className="grid w-full grid-cols-3 gap-3">
        {pulseCards.map(({ label, key }) => (
          <NotchedPanel
            key={key}
            corner="field"
            radius={4}
            notch={8}
            borderWidth={1}
            border="var(--color-border-default)"
            fill="var(--color-surface)"
            contentClassName="flex flex-col gap-1 px-3.5 py-[9px]"
          >
            <span
              className="leading-tight text-text-muted"
              style={{ fontSize: "13px" }}
            >
              {label}
            </span>
            <span
              className={cn(
                "font-bold leading-none text-2xl",
                key === "processes" && data[key] > 1 && "text-danger"
              )}
              style={{ color: "var(--color-text-white)" }}
            >
              {data[key]}
            </span>
          </NotchedPanel>
        ))}
      </div>
    </div>
  );
}