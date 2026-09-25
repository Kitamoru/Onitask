'use client';

/**
 * TaskCommentsPanel — «Комментарии» tab of the task bottom sheet (AGENT-08).
 *
 * Feed sources (RPC get_task_feed, migration 076):
 *  - kind 'comment': durable task_comments (humans + agents)
 *  - kind 'status':  durable task_column_history (column moves)
 *  - kind 'agent':   transient agent_events (last 7 days)
 *
 * Live updates: server-side broadcast `comment_created` on the public
 * `task-comments-<taskId>` channel (the TWA client has no Supabase JWT, so
 * postgres_changes is not deliverable — see migration 076 header).
 *
 * Pagination (FILE-12): feed lives in the React Query cache under
 * `['task-feed', <taskId>]` — useInfiniteQuery with a keyset cursor; the
 * cache is the single source of truth (optimistic submit + broadcast go
 * through queryClient.setQueryData, useState only for the composer).
 *
 * Layout (ДС): горизонтальный паддинг даёт контейнер — TaskViewEdit оборачивает
 * шит в `px-4` (он же `bs-container 24/16/32` в Figma). Внутри панели
 * комментариев доп. паддинга нет (0): лента-кадр `322:27995` и строка
 * composer'а `322:28018` в макете имеют padding 0, иначе карточка и скелетон
 * получают двойной отступ (32px вместо 16px).
 *
 * Submit flow: optimistic append (pending row) → POST → replace with the
 * server row; the server broadcast may arrive first — dedup by item_id.
 *
 * Based on: Figma 322-27840, docs/onitask_flow_.md §22 (ADR-2026-09-06).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { getClient } from '@/lib/supabase/client';
import { getTaskFeedPage, createComment } from '@/lib/api/comments';
import { formatFeedTime } from '@/lib/date';
import { TextArea } from '@/components/ui/desk-ui';
import { isReviewDecision } from '@/lib/reviewDecision';
import { scrollFeedToLatest } from '@/lib/commentsScroll';
import type { CommentsPage, FeedPageCursor, TaskFeedItem } from '@/types/comments';

/** Column keys → ru labels (match TaskForm / board column names) */
import { taskColumnLabel } from '@/lib/taskColumns';

// ─── Avatar ──────────────────────────────────────────────────────────────────

function FeedAvatar({ item, avatarUrl }: { item: TaskFeedItem; avatarUrl?: string }) {
  const size = 32;

  if (item.kind === 'status') {
    return null; // System/status line — single row, no avatar
  }

  if (item.author_type === 'agent') {
    // Agents have no avatar — violet ◆ (agent identity mark).
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: 'rgba(167, 139, 250, 0.12)',
          color: '#A78BFA',
          fontSize: 14,
        }}
        aria-hidden
      >
        ◆
      </div>
    );
  }

  const initials = (item.author_name || '?').slice(0, 1).toUpperCase();

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: 'var(--color-surface-raised, #2A2A2A)',
        color: '#8B8B8B',
        fontSize: 13,
      }}
      aria-hidden
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────────────

/**
 * CommentSkeleton — заглушка ленты на время первой загрузки.
 * Повторяет геометрию реальной карточки комментария: аватар 32px + bubble
 * (`border-white/10 bg-white/[0.04] px-3 py-2`) с именем, временем и двумя
 * строками текста (метрики — как у текста: leading-5 / leading-4).
 */
function CommentSkeleton() {
  const bar = (className: string, alpha: number) => (
    <div className={className} style={{ backgroundColor: `rgba(255,255,255,${alpha})` }} />
  );

  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-start gap-2.5">
          <div
            className="h-8 w-8 shrink-0 rounded-full"
            style={{ backgroundColor: 'var(--color-surface-raised, #2A2A2A)' }}
          />
          <div className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              {bar('h-5 w-1/3 rounded-sm', 0.08)}
              {bar('h-4 w-10 shrink-0 rounded-sm', 0.05)}
            </div>
            <div className="mt-0.5">
              {bar('h-5 w-full rounded-sm', 0.08)}
              {bar('h-5 w-2/3 rounded-sm', 0.08)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface TaskCommentsPanelProps {
  /** Task UUID */
  taskId: string;
  /** Workspace workers (for avatar resolution of comment authors) */
  workers: { id: string; avatarUrl?: string; displayName?: string }[];
  /** Current user's worker ID — own comments render avatar on the right */
  currentUserId?: string;
}

export function TaskCommentsPanel({ taskId, workers, currentUserId }: TaskCommentsPanelProps) {
  const [sendError, setSendError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);

  // ── Feed: useInfiniteQuery (FILE-12) ──────────────────────────────────────
  // Второй гарантийный потребитель React Query (ADR-2026-09-11). Кэш =
  // единственный источник истины; queryKey по задаче — изоляция (нет гонки
  // «фид задачи A в шторке задачи B»). Панель монтируется только на вкладке
  // «Комментарии», поэтому первый фетч — при открытии, повторное открытие
  // < staleTime (60с) — мгновенно из кэша.
  const queryClient = useQueryClient();
  const feedKey = useMemo(() => ['task-feed', taskId] as const, [taskId]);

  const feed = useInfiniteQuery({
    queryKey: feedKey,
    queryFn: ({ pageParam }) => getTaskFeedPage(taskId, pageParam),
    initialPageParam: null as FeedPageCursor | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.items.length > 0
        ? {
            createdAt: lastPage.items[lastPage.items.length - 1].created_at,
            itemId: lastPage.items[lastPage.items.length - 1].item_id,
          }
        : undefined,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  });

  // Страницы приходят «новые сверху»; рендерим хронологически (новые внизу).
  const items = (feed.data?.pages.flatMap((p) => p.items) ?? []).reverse();
  const loading = feed.isPending && items.length === 0;
  const loadError = feed.error
    ? (feed.error instanceof Error ? feed.error.message : String(feed.error))
    : null;

  // Открываем ленту сразу на свежем комментарии. Скроллим только внутренний
  // контейнер ленты, чтобы не двигать внешний scroll BottomSheet и composer.
  useEffect(() => {
    if (loading || items.length === 0) return;
    const frame = requestAnimationFrame(() => {
      scrollFeedToLatest(feedScrollRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [items.length, loading]);

  // ── Мутации кэша фида (кэш = единственный источник истины, паттерн FILE-09) ─
  const mutateFeed = useCallback(
    (updater: (pages: CommentsPage[]) => CommentsPage[] | void) => {
      queryClient.setQueryData<InfiniteData<CommentsPage, FeedPageCursor | null>>(
        feedKey,
        (old) => {
          if (!old || old.pages.length === 0) return old;
          const next = updater(old.pages);
          return next ? { ...old, pages: next } : old;
        },
      );
    },
    [queryClient, feedKey],
  );

  /** Новый комментарий всегда новее всех → в начало первой (новейшей) страницы. */
  const prependFeedItem = useCallback(
    (item: TaskFeedItem) => {
      mutateFeed((pages) =>
        pages.map((page, i) => (i === 0 ? { ...page, items: [item, ...page.items] } : page)),
      );
    },
    [mutateFeed],
  );

  /** Заменить optimistic-строку на серверную (dedupe против broadcast). */
  const replaceFeedItem = useCallback(
    (tempId: string, item: TaskFeedItem) => {
      mutateFeed((pages) => {
        let inserted = false;
        return pages.map((page) => {
          const withoutTemp = page.items.filter((i) => i.item_id !== tempId);
          const hasServer = withoutTemp.some((i) => i.item_id === item.item_id);
          if (hasServer || inserted) return { ...page, items: withoutTemp };
          inserted = true;
          return { ...page, items: [item, ...withoutTemp] };
        });
      });
    },
    [mutateFeed],
  );

  /** Убрать элемент из фида (откат optimistic-строки). */
  const removeFeedItem = useCallback(
    (predicate: (i: TaskFeedItem) => boolean) => {
      mutateFeed((pages) =>
        pages.map((page) => ({ ...page, items: page.items.filter((i) => !predicate(i)) })),
      );
    },
    [mutateFeed],
  );

  // ── Live updates via server-side broadcast ─────────────────────────────────
  useEffect(() => {
    const supabase = getClient();
    const channel = supabase
      .channel(`task-comments-${taskId}`)
      .on('broadcast', { event: 'comment_created' }, ({ payload }: { payload: unknown }) => {
        const item = (payload as { item?: TaskFeedItem } | null)?.item;
        if (!item?.item_id) return;
        mutateFeed((pages) => {
          // Dedupe: авторский POST-ответ или предыдущий broadcast уже добавили
          if (pages.some((p) => p.items.some((i) => i.item_id === item.item_id))) return;
          // Broadcast может прийти ДО ответа POST — заменить optimistic-строку
          return pages.map((page, i) => {
            if (i !== 0) return page;
            const pendingIdx = page.items.findIndex(
              (candidate) =>
                candidate.payload?.pending === true &&
                candidate.author_id === item.author_id &&
                candidate.body === item.body,
            );
            if (pendingIdx !== -1) {
              const nextItems = [...page.items];
              nextItems[pendingIdx] = item;
              return { ...page, items: nextItems };
            }
            return { ...page, items: [item, ...page.items] };
          });
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId, queryClient, feedKey, mutateFeed]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setSendError(null);

    // Optimistic pending row — use the real display name so the pending
    // block is visually identical to the final server row (no swap flicker)
    const tempId = `temp-${Date.now()}`;
    const ownName =
      workers.find((w) => w.id === currentUserId)?.displayName ?? 'Вы';
    const pendingItem: TaskFeedItem = {
      item_id: tempId,
      kind: 'comment',
      author_id: currentUserId ?? null,
      author_name: ownName,
      author_type: 'human',
      body: trimmed,
      created_at: new Date().toISOString(),
      edited_at: null,
      payload: { pending: true },
    };
    prependFeedItem(pendingItem);
    setText('');

    const res = await createComment(taskId, trimmed);
    if (res.error || !res.item) {
      // Roll back the optimistic row
      removeFeedItem((i) => i.item_id === tempId);
      setText(trimmed); // restore the draft
      setSendError(res.error || 'Не удалось отправить комментарий');
    } else {
      // Replace the temp row with the server row (dedupe against broadcast)
      replaceFeedItem(tempId, res.item);
    }
    setSending(false);
  }, [text, sending, taskId, currentUserId, workers, prependFeedItem, replaceFeedItem, removeFeedItem]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const avatarFor = (item: TaskFeedItem): string | undefined => {
    if (!item.author_id) return undefined;
    return workers.find((w) => w.id === item.author_id)?.avatarUrl;
  };

  const canSend = text.trim().length > 0 && !sending;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Feed — горизонтальный паддинг даёт сам шит (TaskViewEdit: px-4),
          внутри панели комментариев он должен быть 0 (ДС, Figma 322:27995) */}
      <div ref={feedScrollRef} className="min-h-0 flex-1 overflow-y-auto py-3">
        {loading ? (
          <CommentSkeleton />
        ) : loadError && items.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-muted">{loadError}</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-muted">
            Комментариев пока нет
          </div>
        ) : (
          <>
            {feed.hasNextPage && (
              <button
                type="button"
                onClick={() => feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
                className="mx-auto mb-3 block text-[12px] text-text-muted underline-offset-2 hover:underline disabled:opacity-50"
              >
                {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать более старые'}
              </button>
            )}
            {loadError && (
              <div className="mb-2 text-center text-[12px] text-red-400">{loadError}</div>
            )}

            <div className="flex flex-col gap-4">
              {items.map((item) => {
                // ── System status line (single centered row, no bubble) ──
                if (item.kind === 'status') {
                  const from = taskColumnLabel(typeof item.payload?.from_column === 'string' ? item.payload.from_column : null);
                  const to = taskColumnLabel(typeof item.payload?.to_column === 'string' ? item.payload.to_column : null);
                  return (
                    <div
                      key={item.item_id}
                      className="text-center text-[12px] leading-4 text-text-muted"
                    >
                      {item.author_name}: {from} → {to} · {formatFeedTime(item.created_at)}
                    </div>
                  );
                }

                // ── Agent activity row ──
                if (item.kind === 'agent') {
                  return (
                    <div
                      key={item.item_id}
                      className="flex items-start gap-2.5 text-[13px] text-text-muted"
                    >
                      <FeedAvatar item={item} />
                      <div className="min-w-0 flex-1 pt-1">
                        <span className="text-[#A78BFA]">{item.author_name}</span>{' '}
                        {item.body}{' '}
                        <span className="text-[12px]">
                          {formatFeedTime(item.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                }

                {/* ── Comment bubble (Figma 322-27840) ── */}
                const isPending = !!item.payload?.pending;
                const isReview = isReviewDecision(item);
                const isOwn =
                  currentUserId != null &&
                  item.author_id === currentUserId &&
                  item.author_type === 'human';
                return (
                  <div
                    key={item.item_id}
                    className={`flex items-start gap-2.5 ${isOwn ? 'flex-row-reverse justify-end' : ''}`}
                  >
                    <FeedAvatar item={item} avatarUrl={avatarFor(item)} />
                    <div
                      className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2"
                      style={{
                        ...(isPending ? { opacity: 0.5 } : null),
                        ...(isReview
                          ? { borderColor: 'var(--color-signal-cyan)' }
                          : null),
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[14px] font-medium leading-5 text-text">
                          {item.author_name}
                        </span>
                        <span className="shrink-0 text-[12px] leading-4 text-text-muted">
                          {formatFeedTime(item.created_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-5 text-text">
                        {item.body}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Composer — тот же принцип: 0 (Figma 322:28018), шит уже даёт px-4.
          shrink-0: composer — статичный низ панели, растягивается только лента. */}
      <div
        className="shrink-0 border-t border-white/10 py-3"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {sendError && <div className="mb-2 text-[12px] text-red-400">{sendError}</div>}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextArea
              corner="field"
              value={text}
              onChange={setText}
              maxLength={2000}
              placeholder="Текст сообщения"
              onKeyDown={(e) => {
                // Enter = send, Shift+Enter = newline
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            aria-label="Отправить"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-text transition-opacity disabled:opacity-40"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {/* outline / send (Figma icon set) */}
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22 11 13 2 9Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
