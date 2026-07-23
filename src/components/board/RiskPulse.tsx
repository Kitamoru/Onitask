"use client";

import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

/**
 * RiskPulse component — displays aggregated risk metrics across all boards.
 *
 * Figma specs (from boards page):
 *   - Summary label: "Сводка по всем моим доскам", fontSize=14, fontWeight=500, lineHeight=16px, color=#8B8B8B
 *   - Grid: 3-col, gap=8px
 *   - Card: padding=12px, gap=8px, radius=4, notch=8
 *   - Number: fontSize=16, fontWeight=500 (Medium), color=#FAFAFA
 *   - Label: fontSize=12, fontWeight=500, lineHeight=14px, color=#8B8B8B
 */

export interface RiskPulseData {
  people: number;
  processes: number;
  escalations: number;
}

export interface RiskPulseProps {
  data: RiskPulseData;
}

const pulseCards = [
  { label: "Люди", key: "people" as const },
  { label: "Процессы", key: "processes" as const },
  { label: "Эскалации", key: "escalations" as const },
];

export function RiskPulse({ data }: RiskPulseProps) {
  return (
    <div className="flex flex-col w-full gap-4">
      {/* Summary label */}
      <p
        style={{
          fontFamily: "Inter Display, system-ui, sans-serif",
          fontSize: "14px",
          lineHeight: "16px",
          fontWeight: 500,
          color: "#8B8B8B",
        }}
      >
        Сводка по всем моим доскам
      </p>

      {/* Summary cards grid — 3-col, gap=8px */}
      <div className="grid w-full grid-cols-3 gap-2">
        {pulseCards.map(({ label, key }) => (
          <NotchedPanel
            key={key}
            corner="field"
            radius={4}
            notch={8}
            borderWidth={1}
            border="var(--color-line)"
            fill="var(--color-surface)"
            contentClassName="flex flex-col gap-2 p-3"
          >
            <span
              style={{
                fontFamily: "Inter Display, system-ui, sans-serif",
                fontSize: "12px",
                lineHeight: "14px",
                fontWeight: 500,
                color: "#8B8B8B",
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontFamily: "Inter Display, system-ui, sans-serif",
                fontSize: "16px",
                lineHeight: "20px",
                fontWeight: 500,
                color: data[key] > 1 && key === "processes" ? "#EF4444" : "#FAFAFA",
              }}
            >
              {data[key]}
            </span>
          </NotchedPanel>
        ))}
      </div>
    </div>
  );
}
