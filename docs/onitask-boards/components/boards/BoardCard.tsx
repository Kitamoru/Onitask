import Image from "next/image";
import { cn } from "@/lib/cn";
import { NotchedPanel } from "@/components/ui/NotchedPanel";
import { StatBox } from "@/components/boards/StatBox";

export type BoardCardData = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string;
  memberCount: number;
  agentCount: number;
  stats: {
    inProgress: number;
    escalations: number;
    overloaded: number;
    done: number;
  };
  sprint: {
    label: string; // "Спринт 3"
    scope: string; // "Auth & MCP"
    dayCurrent: number;
    dayTotal: number;
  };
};

/**
 * Large container: radius 4px, bottom-right chamfer 16px.
 *
 * The currently-selected board (isActive) gets the same teal→gold
 * gradient border used by the primary CTA buttons — this *is* the
 * "frame around the active board" the design calls for, not a separate
 * selection treatment.
 */
export function BoardCard({
  board,
  isActive = false,
  onSelect,
}: {
  board: BoardCardData;
  isActive?: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(board.id)}
      className="block w-full appearance-none border-0 bg-transparent p-0 text-left"
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
        {/* head: avatar + name/handle */}
        <div className="flex items-start gap-3">
          <Image
            src={board.avatarUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 flex-none rounded-lg object-cover"
          />
          <div className="pt-px">
            <div className="text-base font-semibold leading-tight text-text">
              {board.name}
            </div>
            <div className="mt-[3px] text-[13px] leading-tight text-text-muted">
              @{board.handle} &bull; {board.memberCount} участника + {board.agentCount} агента
            </div>
          </div>
        </div>

        {/* stat pills */}
        <div className="mt-2 flex gap-2">
          {/* mt-2 (8px) — measured against real Inter, not eyeballed */}
          <StatBox variant="pill" label="В работе" value={board.stats.inProgress} />
          <StatBox variant="pill" label="Эскалации" value={board.stats.escalations} />
          <StatBox variant="pill" label="Перегружен" value={board.stats.overloaded} />
          <StatBox variant="pill" label="Готово" value={board.stats.done} />
        </div>

        <hr className="mt-3 border-t border-line" />

        <div className="mt-2 text-[13px] text-text-muted">
          {board.sprint.label} &bull; {board.sprint.scope} &bull; {board.sprint.dayCurrent}/
          {board.sprint.dayTotal} дней
        </div>
      </NotchedPanel>
    </button>
  );
}
