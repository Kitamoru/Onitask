"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/contexts/DataContext";
import { RiskPulse, BoardCard } from "@/components/board";
import { Button } from "@/components/ui/desk-ui/Button";
import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import type { RiskPulseData, BoardCardData } from "@/components/board";

/**
 * Boards Overview Page — "Стол" (Desk)
 *
 * Telegram viewport safe areas via --tg-viewport-stable-height,
 * --tg-content-safe-top, --tg-content-safe-bottom (set by TelegramViewportBridge).
 *
 * Layout specs from docs/onitask-boards:
 *   - Large containers (board cards): radius=4px, notch=16px
 *   - Small containers (summary tiles, stat pills): radius=4px, notch=8px
 *   - Active board + "Добавить доску" get teal→gold gradient border
 */

function getTelegramInitData(): string {
  if (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return "";
}

export default function BoardsPage() {
  const router = useRouter();
  const { isLoading: authLoading, error: authError } = useAuth();
  const { state } = useData();

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

  const activeWorkspace = workspaces[0]?.slug || "";

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
      style={{
        paddingTop: "max(48px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--tg-content-safe-bottom, 0px) + var(--tg-safe-area-bottom, 0px))",
      }}
    >
      <div className="mx-auto max-w-[390px] px-4 pb-8">
        {/* Header: "Стол" with flag icon */}
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[22px] w-[22px] flex-none text-text-primary"
            aria-hidden="true"
          >
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          <h1
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: "24px",
              lineHeight: "1.2",
              fontWeight: "700",
              letterSpacing: "-0.025em",
              color: "#FAFAFA",
            }}
          >
            Стол
          </h1>
        </div>

        {/* Sub-header: board count + active */}
        <p
          style={{
            marginTop: "4px",
            fontSize: "14px",
            lineHeight: "1.25",
            color: "#8B8B8B",
          }}
        >
          {workspaces.length}{" "}
          {pluralDoski(workspaces.length)}
          {" · активная:"}{" "}
          {activeWorkspace && (
            <span style={{ color: "#ff9900" }}>@{activeWorkspace}</span>
          )}
        </p>

        {/* Summary section */}
        <p
          style={{
            marginTop: "10px",
            fontSize: "14px",
            lineHeight: "1.286",
            color: "#8B8B8B",
          }}
        >
          Сводка по всем моим доскам
        </p>

        <RiskPulse data={riskData} onSprintClick={() => router.push("/sprints")} />

        {/* "К спринту" button — outline variant with gradient border */}
        <Button corner="field" variant="outline" className="mt-2">
          К спринту
        </Button>

        {/* Board list section */}
        <SectionHeader title="Мои доски" />

        <div className="flex flex-col gap-2">
          {boardCards.map((card) => (
            <BoardCard
              key={card.id}
              data={card as BoardCardData}
              onClick={() => router.push(`/board/${card.slug}`)}
              isActive={card.slug === activeWorkspace}
            />
          ))}
        </div>

        {/* "Добавить доску" — outline variant with gradient border */}
        <Button
          corner="field"
          variant="outline"
          className="mt-2"
          onClick={() => router.push("/board/create")}
        >
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