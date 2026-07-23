"use client";

import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatBox } from "@/components/boards/StatBox";
import { BoardCard, type BoardCardData } from "@/components/boards/BoardCard";

/**
 * Drop this in as the route component, e.g.
 *   app/(desk)/boards/page.tsx  →  export { BoardsPage as default }
 *
 * Same Telegram-viewport safe-area pattern as CreateDeskPage — mount
 * useTelegramViewport() once in the root layout, not here.
 */

type BoardsSummary = {
  people: number;
  processes: number;
  escalations: number;
};

export function BoardsPage({
  deskName = "Стол",
  boards,
  activeBoardId,
  summary,
}: {
  deskName?: string;
  boards: BoardCardData[];
  activeBoardId: string;
  summary: BoardsSummary;
}) {
  const activeBoard = boards.find((b) => b.id === activeBoardId);

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height)] bg-bg"
      style={{
        paddingTop: "max(48px, var(--tg-content-safe-top))",
        paddingBottom:
          "calc(var(--tg-content-safe-bottom) + var(--tg-safe-area-bottom))",
      }}
    >
      <div className="mx-auto max-w-[390px] px-page-gutter pb-8">
        {/* header */}
        <div className="flex items-center gap-2">
          <FlagIcon className="h-[22px] w-[22px] flex-none text-text" />
          <h1 className="text-2xl font-bold tracking-tight text-text">{deskName}</h1>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {boards.length} {pluralDoski(boards.length)} &bull; активная:{" "}
          {activeBoard && <span className="text-accent">@{activeBoard.handle}</span>}
        </p>

        {/* summary */}
        <p className="mt-2.5 text-sm text-text-muted">Сводка по всем моим доскам</p>
        <div className="mt-3 flex gap-3">
          <StatBox label="Люди" value={summary.people} />
          <StatBox label="Процессы" value={summary.processes} tone="danger" />
          <StatBox label="Эскалации" value={summary.escalations} />
        </div>

        <Button corner="field" className="mt-2">
          К спринту
        </Button>

        {/* board list */}
        <SectionHeader title="Мои доски" />
        <div className="flex flex-col gap-2">
          {boards.map((board) => (
            <BoardCard key={board.id} board={board} isActive={board.id === activeBoardId} />
          ))}
        </div>

        <Button corner="field" className="mt-2">
          Добавить доску
        </Button>
      </div>
    </main>
  );
}

function pluralDoski(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "доска";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "доски";
  return "досок";
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}
