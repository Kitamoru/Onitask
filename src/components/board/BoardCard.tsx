"use client";

import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

/**
 * BoardCard component — displays a single board/workspace card.
 *
 * Figma specs (task-card / selected=true):
 *   - Card: padding=12px, gap=12px, radius=4, notch=16
 *   - Logo: 36x36, borderRadius=1.6px
 *   - Name: fontSize=16, fontWeight=500 (Medium), color=#FAFAFA
 *   - Info: fontSize=12, fontWeight=500, color=#8B8B8B
 *   - Stats grid: 4-col, gap=4px
 *   - Stat pill: padding=8px 4px, gap=2px
 *   - Stat number: fontSize=16, fontWeight=600 (SemiBold), color=#FAFAFA
 *   - Stat label: fontSize=10, fontWeight=500, color=#8B8B8B
 *   - Active board gets teal→gold gradient border
 */

export interface BoardStats {
  inQueue: number;
  inWork: number;
  onReview: number;
  done: number;
}

export interface SprintInfo {
  name: string;
  topic: string;
  daysElapsed: number;
  totalDays: number;
}

export interface BoardCardData {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string;
  memberCount: number;
  agentCount: number;
  stats: BoardStats;
  sprint?: SprintInfo;
}

export interface BoardCardProps {
  data: BoardCardData;
  onClick?: () => void;
  isActive?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

// Stat labels per Figma: "В работе", "Эскалации", "Перегружен", "Готово"
const statLabels: (keyof BoardStats)[] = ["inQueue", "inWork", "onReview", "done"];
const statLabelsRu = ["В очереди", "В работе", "На проверке", "Сделано"];

export function BoardCard({ data, onClick, isActive, isSelected, onSelect }: BoardCardProps) {
  const handleClick = () => {
    if (isSelected && onClick) {
      onClick();
    } else if (onSelect) {
      onSelect(data.id);
    }
  };

  const highlighted = isActive || isSelected;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="block w-full appearance-none border-0 bg-transparent p-0 text-left"
      aria-label={`Доска ${data.name}`}
    >
      <NotchedPanel
        corner="field"
        radius={4}
        notch={16}
        borderWidth={highlighted ? 1.5 : 1}
        borderGradient={
          highlighted
            ? ["var(--color-grad-add-from)", "var(--color-grad-add-to)"]
            : undefined
        }
        border={highlighted ? undefined : "var(--color-line)"}
        fill={highlighted ? "var(--color-card)" : "var(--color-surface)"}
        contentClassName="p-3"
      >
        {/* Head: logo + name/handle */}
        <div className="flex items-start gap-3">
          {/* Logo — 36x36, borderRadius=1.6px */}
          <div
            className="h-9 w-9 flex-none overflow-hidden"
            style={{ borderRadius: "1.6px" }}
          >
            {data.avatarUrl ? (
              <img
                src={data.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                aria-hidden="true"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span
                  style={{
                    fontFamily: "Inter Display, system-ui, sans-serif",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#8B8B8B",
                  }}
                >
                  {data.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="pt-px">
            <div
              style={{
                fontFamily: "Inter Display, system-ui, sans-serif",
                fontSize: "16px",
                lineHeight: "20px",
                fontWeight: 500,
                color: "#FAFAFA",
              }}
            >
              {data.name}
            </div>
            <div
              className="mt-[2px] flex items-center gap-1"
              style={{
                fontSize: "12px",
                lineHeight: "14px",
                fontWeight: 500,
                color: "#8B8B8B",
              }}
            >
              <span>@{data.slug}</span>
              <span>•</span>
              <span>{data.memberCount} участника + {data.agentCount} агента</span>
            </div>
          </div>
        </div>

        {/* Stats grid — 4-col, gap=4px */}
        <div className="mt-3 grid w-full grid-cols-4 gap-1">
          {statLabels.map((key, i) => (
            <NotchedPanel
              key={key}
              corner="action"
              radius={4}
              notch={8}
              borderWidth={1}
              border="var(--color-line)"
              fill="var(--color-surface)"
              contentClassName="flex flex-col items-center gap-1 py-2"
            >
              <span
                style={{
                  fontFamily: "Inter Display, system-ui, sans-serif",
                  fontSize: "16px",
                  lineHeight: "20px",
                  fontWeight: 600,
                  color: "#FAFAFA",
                }}
              >
                {data.stats[key]}
              </span>
              <span
                style={{
                  fontFamily: "Inter Display, system-ui, sans-serif",
                  fontSize: "10px",
                  lineHeight: "12px",
                  fontWeight: 500,
                  color: "#8B8B8B",
                }}
              >
                {statLabelsRu[i]}
              </span>
            </NotchedPanel>
          ))}
        </div>

        {/* Divider */}
        <hr className="mt-3 border-t border-line" />

        {/* Sprint info */}
        {data.sprint && (
          <div
            className="mt-3 flex items-center gap-1"
            style={{
              fontSize: "12px",
              lineHeight: "14px",
              fontWeight: 500,
              color: "#8B8B8B",
            }}
          >
            <span>{data.sprint.name}</span>
            <span>•</span>
            <span>{data.sprint.topic}</span>
            <span>•</span>
            <span>{data.sprint.daysElapsed}/{data.sprint.totalDays} дней</span>
          </div>
        )}
      </NotchedPanel>
    </button>
  );
}