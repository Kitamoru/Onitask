"use client";

import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";

/**
 * BoardCard component — displays a single board/workspace card.
 *
 * Uses NotchedPanel with corner="field", radius=4, notch=16 (large container).
 * Active board gets teal→gold gradient border via borderGradient prop.
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
}

// New stat labels per requirement #3
const statLabels: (keyof BoardStats)[] = ["inQueue", "inWork", "onReview", "done"];
const statLabelsRu = ["В очереди", "В работе", "На проверке", "Сделано"];

export function BoardCard({ data, onClick, isActive }: BoardCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full appearance-none border-0 bg-transparent p-0 text-left"
      aria-label={`Доска ${data.name}`}
    >
      <NotchedPanel
        corner="field"
        radius={4}
        notch={16}
        borderWidth={isActive ? 1.5 : 1}
        borderGradient={
          isActive
            ? ["var(--color-grad-add-from)", "var(--color-grad-add-to)"]
            : undefined
        }
        border={isActive ? undefined : "var(--color-line)"}
        fill="var(--color-card)"
        contentClassName="p-4"
      >
        {/* Head: avatar + name/handle */}
        <div className="flex items-start gap-3">
          {/* Avatar/logo */}
          <div
            className="h-9 w-9 flex-none overflow-hidden rounded-lg object-cover"
            style={{ backgroundColor: "var(--color-bg-surface-hover)" }}
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
                    fontSize: "14px",
                    fontWeight: "var(--font-weight-medium)",
                    color: "var(--color-text-muted)",
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
                fontFamily: "var(--font-family-display)",
                fontSize: "var(--text-heading-md)",
                lineHeight: "var(--text-heading-md-line)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-text-primary)",
              }}
            >
              {data.name}
            </div>
            <div
              className="mt-[3px]"
              style={{
                fontSize: "13px",
                lineHeight: "1.2",
                color: "var(--color-text-muted)",
              }}
            >
              @{data.slug} • {data.memberCount} участника + {data.agentCount} агента
            </div>
          </div>
        </div>

        {/* Stat pills row */}
        <div className="mt-2 flex gap-2">
          {statLabels.map((key, i) => (
            <NotchedPanel
              key={key}
              corner="field"
              radius={4}
              notch={8}
              borderWidth={1}
              border="var(--color-border-default)"
              fill="var(--color-surface)"
              contentClassName="flex flex-col gap-[3px] py-[7px] pl-3 pr-1"
            >
              <span
                style={{
                  fontSize: "11.5px",
                  lineHeight: "1.1",
                  color: "var(--color-text-muted)",
                }}
              >
                {statLabelsRu[i]}
              </span>
              <span
                style={{
                  fontSize: "20px",
                  fontWeight: "700",
                  lineHeight: "1",
                  color: "var(--color-text-white)",
                }}
              >
                {data.stats[key]}
              </span>
            </NotchedPanel>
          ))}
        </div>

        {/* Divider */}
        <hr className="mt-3 border-t border-line" />

        {/* Sprint info */}
        {data.sprint && (
          <div
            style={{
              marginTop: "8px",
              fontSize: "13px",
              color: "var(--color-text-muted)",
            }}
          >
            {data.sprint.name} • {data.sprint.topic} • {data.sprint.daysElapsed}/{data.sprint.totalDays} дней
          </div>
        )}
      </NotchedPanel>
    </button>
  );
}