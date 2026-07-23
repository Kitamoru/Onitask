"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/contexts/DataContext";
import { RiskPulse, BoardCard } from "@/components/board";
import { Button } from "@/components/ui/desk-ui/Button";
import type { RiskPulseData, BoardCardData } from "@/components/board";

/**
 * Boards Overview Page — "Стол" (Desk)
 *
 * Figma specs (from /boards page "stol"):
 *   - Main frame: padding=16px, gap=24px, bg=#0A0A0A, width=390px
 *   - Header: row gap=8px, icon 20x20, "Стол" fontSize=20 fontWeight=500, color=#FFFFFF
 *   - Sub-header: row gap=4px, "N доски • активная:" fontSize=12 fontWeight=500, color=#8B8B8B
 *     active slug color=#F59E0B
 *   - center-container: column gap=20px
 *   - Summary section: label "Сводка по всем моим доскам" fontSize=14 fontWeight=500
 *   - RiskPulse cards: grid 3-col gap=8px
 *   - "К спринту" button: button-sec-s, height=40, padding=0 16px
 *   - Board list: column gap=12px
 *   - "Добавить доску" button: button-sec-s, height=40, padding=0 16px
 *   - bottom-filler: height=80px
 *
 * Telegram viewport safe areas via --tg-viewport-stable-height,
 * --tg-content-safe-top, --tg-content-safe-bottom (set by TelegramViewportBridge).
 */

export default function BoardsPage() {
  const router = useRouter();
  const { isLoading: authLoading, error: authError } = useAuth();
  const { state } = useData();
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const workspaces = state.workspaces.items;
  const riskData: RiskPulseData = state.boards.riskData ?? {
    people: 0,
    processes: 0,
    escalations: 0,
  };
  const boardCards = state.boards.cards;

  // Auth loading state
  if (authLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)]"
        style={{ backgroundColor: "#0A0A0A" }}
      >
        <p style={{ color: "#8B8B8B" }}>Загрузка...</p>
      </div>
    );
  }

  // Auth error state
  if (authError) {
    return (
      <div
        className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)] p-4"
        style={{ backgroundColor: "#0A0A0A" }}
      >
        <div className="text-center max-w-sm">
          <p style={{ color: "#EF4444", fontFamily: "system-ui" }}>
            Ошибка авторизации. Откройте приложение через Telegram Web App.
          </p>
        </div>
      </div>
    );
  }

  // Show skeleton while boards data is loading
  if (!state.boards.lastUpdated) {
    return (
      <div
        className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)]"
        style={{ backgroundColor: "#0A0A0A" }}
      >
        <p style={{ color: "#8B8B8B" }}>Загрузка...</p>
      </div>
    );
  }

  // The first workspace is considered "active" by default.
  // When user taps another card, selectedBoardId takes over.
  const defaultActiveSlug = workspaces[0]?.slug || "";
  // Show slug of selected board, or the default active one
  const selectedBoard = selectedBoardId
    ? boardCards.find(c => c.id === selectedBoardId)
    : null;
  const displaySlug = selectedBoard?.slug ?? defaultActiveSlug;

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
      style={{
        paddingTop: "max(48px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--tg-content-safe-bottom, 0px) + var(--tg-safe-area-bottom, 0px))",
      }}
    >
      <div className="w-full px-4 pb-8">
        {/* Header: "Стол" with desk icon (20x20) */}
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 flex-none text-text-primary"
            aria-hidden="true"
          >
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          <h1
            style={{
              fontFamily: "Inter Display, system-ui, sans-serif",
              fontSize: "20px",
              lineHeight: "24px",
              fontWeight: 500,
              letterSpacing: "-0.025em",
              color: "#FFFFFF",
            }}
          >
            Стол
          </h1>
        </div>

        {/* Sub-header: board count + active slug (fontSize=12, fontWeight=500) */}
        <p
          style={{
            marginTop: "4px",
            fontSize: "12px",
            lineHeight: "14px",
            fontWeight: 500,
            color: "#8B8B8B",
          }}
        >
          {workspaces.length}{" "}
          {pluralDoski(workspaces.length)}
          {" · активная:"}{" "}
          {displaySlug && (
            <span style={{ color: "#F59E0B" }}>@{displaySlug}</span>
          )}
        </p>

        {/* center-container: column gap=20px */}
        <div className="mt-6 flex flex-col gap-5">
          {/* Summary section */}
          <RiskPulse data={riskData} />

          {/* Board list section — column gap=12px */}
          <div className="flex flex-col gap-3">
            {boardCards.map((card) => (
              <BoardCard
                key={card.id}
                data={card as BoardCardData}
                isActive={selectedBoardId === null && card.slug === defaultActiveSlug}
                isSelected={selectedBoardId === card.id}
                onSelect={(id) => setSelectedBoardId(id)}
                onClick={() => router.push(`/board/${card.slug}`)}
              />
            ))}
          </div>

          {/* "Добавить доску" button — button-sec-s, height=40 */}
          {/* Same width as BoardCard — no px-4 to avoid extra inner padding */}
          <Button
            corner="action"
            variant="outline"
            className="h-10"
            onClick={() => router.push("/board/create")}
          >
            Добавить доску
          </Button>
        </div>

        {/* bottom-filler: height=80px */}
        <div className="h-20" />
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