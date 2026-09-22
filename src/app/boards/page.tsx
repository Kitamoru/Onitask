"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { useData } from "@/contexts/DataContext";
import { useBoardCounts } from "@/hooks/useBoardCounts";
import { BOARD_COUNTS_QUERY_KEY } from "@/lib/api/boardCounts";
import { RiskPulse, BoardCard } from "@/components/board";
import { Button } from "@/components/ui/desk-ui/Button";
import type { RiskPulseData, BoardCardData } from "@/components/board";
import { OrbitLoader } from "@/components/shared/OrbitLoader";

/** Сброс скролла при переходе на страницу */
function useScrollReset() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}

/**
 * Boards Overview Page — «Стол» (Desk)
 *
 * BOARD-AGG: карточки и RiskPulse — серверные агрегаты через useBoardCounts
 * (React Query, queryKey ['board-counts']). Страница рендерится мгновенно:
 *  - workspaces уже в DataContext (authData);
 *  - агрегаты из кэша RQ (prefetch после первого лоада), фоновый refresh
 *    при stale/визите — без скелетона (placeholderData: previous);
 *  - если агрегатов нет вообще (холодный старт) — блюр-заглушки на месте
 *    цифр, фулскрин-лоадера больше нет.
 *
 * Active workspace:
 * - Single source of truth: DataContext.activeWorkspaceId
 * - Первый клик по карточке → setActiveWorkspace (сделать активной)
 * - Второй клик по уже выбранной → переход на /board/[slug]
 */
export default function BoardsPage() {
  useScrollReset();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isLoading: authLoading, error: authError } = useTelegramAuth();
  const { state, setActiveWorkspace, loadBoardsData } = useData();
  const countsQuery = useBoardCounts(!authLoading && !authError);
  const counts = countsQuery.data;

  // Флаг «нужен refresh» после удаления доски и т.п.: full load обновляет
  // workspaces в DataContext, invalidate — агрегаты ['board-counts'].
  const needDataRefreshRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("boards-needs-refresh")) {
      needDataRefreshRef.current = true;
      sessionStorage.removeItem("boards-needs-refresh");
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!needDataRefreshRef.current) return;
    needDataRefreshRef.current = false;
    void loadBoardsData(state.activeWorkspaceId ?? undefined);
    void queryClient.invalidateQueries({ queryKey: BOARD_COUNTS_QUERY_KEY });
  }, [authLoading, loadBoardsData, queryClient, state.activeWorkspaceId]);

  const workspaces = state.workspaces.items;
  const statsLoading = countsQuery.isPending && !counts;

  const zeroStats = { inQueue: 0, inWork: 0, onReview: 0, done: 0 };
  const boardCards = workspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    memberCount: counts?.members[ws.id]?.humans ?? 0,
    agentCount: counts?.members[ws.id]?.agents ?? 0,
    stats: counts?.counts[ws.id] ?? zeroStats,
    sprint: counts?.sprintsByWorkspace[ws.id],
  }));

  const riskData: RiskPulseData =
    counts?.riskData ?? { people: 0, processes: 0, escalations: 0 };

  // ── Auth loading ────────────────────────────────────────────────────────
  const bgStyle = { background: 'var(--color-bg-primary-dark, #0A0A0A)' };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[var(--tg-viewport-stable-height,100dvh)]" style={bgStyle}>
        <OrbitLoader />
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

  // ── Counts error (нет кэша и fetch упал) ────────────────────────────────
  if (countsQuery.isError && !counts) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-[var(--tg-viewport-stable-height,100dvh)] p-4" style={bgStyle}>
        <p style={{ color: "#EF4444", fontFamily: "system-ui", textAlign: "center" }}>
          Не удалось загрузить данные досок.
        </p>
        <Button
          corner="action"
          variant="outline"
          className="h-10"
          onClick={() => void countsQuery.refetch()}
        >
          Повторить
        </Button>
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
        background: 'var(--color-bg-primary-dark, #0A0A0A)',
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
          <RiskPulse data={riskData} loading={statsLoading} />

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
                  statsLoading={statsLoading}
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
