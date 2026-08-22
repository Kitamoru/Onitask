"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { useData } from "@/contexts/DataContext";
import { RiskPulse, BoardCard } from "@/components/board";
import { Button } from "@/components/ui/desk-ui/Button";
import type { RiskPulseData, BoardCardData } from "@/components/board";

/** Сброс скролла при переходе на страницу */
function useScrollReset() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}

/**
 * Boards Overview Page — "Стол" (Desk)
 *
 * Active workspace:
 * - Single source of truth: DataContext.activeWorkspaceId
 * - Первый клик по карточке → setActiveWorkspace (сделать активной)
 * - Второй клик по уже выбранной → переход на /board/[slug]
 *
 * Board cards (stats) обновляются full load'ом:
 * - при первом заходе / force-refresh после удаления
 * - если tasks обновились позже boards (работа на FlowBoard)
 * - если данные старше 30s
 */
export default function BoardsPage() {
  useScrollReset();
  const router = useRouter();
  const { isLoading: authLoading, error: authError } = useTelegramAuth();
  const { state, setActiveWorkspace, loadBoardsData, dataError } = useData();

  const [forceRefresh, setForceRefresh] = useState(false);

  // Флаг «нужен refresh» после удаления доски и т.п.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timestamp = sessionStorage.getItem("boards-needs-refresh");
    if (timestamp) {
      setForceRefresh(true);
      sessionStorage.removeItem("boards-needs-refresh");
    }
  }, []);

  const refreshBoards = useCallback(() => {
    loadBoardsData(state.activeWorkspaceId ?? undefined);
  }, [loadBoardsData, state.activeWorkspaceId]);

  // Один эффект загрузки: force / stale / tasks новее boards
  useEffect(() => {
    if (authLoading) return;

    const boardsUpdated = state.boards.lastUpdated;
    const tasksUpdated = state.tasks.lastUpdated;

    const needsForce = forceRefresh;
    const neverLoaded = !boardsUpdated;
    const isStale = boardsUpdated != null && Date.now() - boardsUpdated >= 30_000;
    // После работы на FlowBoard tasks обновляются (realtime / partial),
    // cards — только full load. Если tasks свежее boards — перезагружаем.
    const tasksNewerThanBoards =
      boardsUpdated != null &&
      tasksUpdated != null &&
      tasksUpdated > boardsUpdated;

    if (!needsForce && !neverLoaded && !isStale && !tasksNewerThanBoards) {
      return;
    }

    refreshBoards();
    if (needsForce) setForceRefresh(false);
  }, [
    authLoading,
    forceRefresh,
    refreshBoards,
    state.boards.lastUpdated,
    state.tasks.lastUpdated,
  ]);

  const workspaces = state.workspaces.items;
  const riskData: RiskPulseData = state.boards.riskData ?? {
    people: 0,
    processes: 0,
    escalations: 0,
  };
  const boardCards = state.boards.cards;

  // ── Auth loading ────────────────────────────────────────────────────────
  const bgStyle = { background: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark, #0A0A0A))' };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)]" style={bgStyle}>
        <p style={{ color: "#8B8B8B" }}>Загрузка...</p>
      </div>
    );
  }

  // ── Auth error ──────────────────────────────────────────────────────────
  if (authError) {
    return (
      <div className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)] p-4" style={bgStyle}>
        <div className="text-center max-w-sm">
          <p style={{ color: "#EF4444", fontFamily: "system-ui" }}>
            Ошибка авторизации. Откройте приложение через Telegram Web App.
          </p>
        </div>
      </div>
    );
  }

  // ── Data error (full load failed) ───────────────────────────────────────
  if (dataError && !state.boards.lastUpdated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-[var(--tg-viewport-stable-height,100dvh)] p-4" style={bgStyle}>
        <p style={{ color: "#EF4444", fontFamily: "system-ui", textAlign: "center" }}>
          Не удалось загрузить доски.
          {dataError === "timeout_loading_boards_data"
            ? " Превышено время ожидания."
            : null}
        </p>
        <Button corner="action" variant="outline" className="h-10" onClick={refreshBoards}>
          Повторить
        </Button>
      </div>
    );
  }

  // ── Skeleton: boards ещё не загружались ─────────────────────────────────
  if (!state.boards.lastUpdated) {
    return (
      <div className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)]" style={bgStyle}>
        <p style={{ color: "#8B8B8B" }}>Загрузка...</p>
      </div>
    );
  }

  const activeWorkspaceId = state.activeWorkspaceId;

  const selectedBoard = activeWorkspaceId
    ? boardCards.find((c) => c.id === activeWorkspaceId)
    : null;
  const displaySlug =
    selectedBoard?.slug ?? workspaces[0]?.slug ?? boardCards[0]?.slug ?? "";

  /** Первый клик — активировать; второй (уже selected) — открыть доску */
  const handleCardClick = (card: { id: string; slug: string }) => {
    if (activeWorkspaceId === card.id) {
      router.push(`/board/${card.slug}`);
    } else {
      void setActiveWorkspace(card.id);
    }
  };

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)]"
      style={{
        background: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark, #0A0A0A))',
        paddingTop: "max(64px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--size-bottom-menu-height) + 16px)",
      }}
    >
      <div className="w-full px-4 pb-8">
        {/* Header */}
        <div className="flex items-center gap-2">
          <img
            src="/icons/desk.svg"
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 flex-none"
            aria-hidden="true"
          />
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

        {/* Sub-header */}
        <p
          style={{
            marginTop: "4px",
            fontSize: "12px",
            lineHeight: "14px",
            fontWeight: 500,
            color: "#8B8B8B",
          }}
        >
          {workspaces.length} {pluralDoski(workspaces.length)}
          {" · активная:"}{" "}
          {displaySlug && (
            <span style={{ color: "#F59E0B" }}>@{displaySlug}</span>
          )}
        </p>

        <div className="mt-6 flex flex-col gap-5">
          <RiskPulse data={riskData} />

          {/* Empty state */}
          {boardCards.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#8B8B8B",
                  textAlign: "center",
                }}
              >
                Нет досок
              </p>
              <Button
                corner="action"
                variant="outline"
                className="h-10"
                onClick={() => router.push("/board/create")}
              >
                Добавить доску
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {boardCards.map((card) => (
                <BoardCard
                  key={card.id}
                  data={card as BoardCardData}
                  isSelected={activeWorkspaceId === card.id}
                  onSelect={() => void setActiveWorkspace(card.id)}
                  onClick={() => handleCardClick(card)}
                />
              ))}
            </div>
          )}

          {boardCards.length > 0 && (
            <Button
              corner="action"
              variant="outline"
              className="h-10"
              onClick={() => router.push("/board/create")}
            >
              Добавить доску
            </Button>
          )}
        </div>

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
