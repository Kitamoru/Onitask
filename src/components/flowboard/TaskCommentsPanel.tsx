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
 * Submit flow: optimistic append (pending row) → POST → replace with the
 * server row; the server broadcast may arrive first — dedup by item_id.
 *
 * Based on: Figma 322-27840, docs/onitask_flow_.md §22 (ADR-2026-09-06).
 */

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '@/lib/supabase/client';
import { getTaskFeed, createComment } from '@/lib/api/comments';
import { formatFeedTime } from '@/lib/date';
import { TextArea } from '@/components/ui/desk-ui';
import type { TaskFeedItem } from '@/types/comments';

/** Column keys → ru labels (match TaskForm / board column names) */
const COLUMN_LABELS: Record<string, string> = {
  inbox: 'Входящие',
  backlog: 'В очереди',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
};

function columnLabel(key: unknown): string {
  return COLUMN_LABELS[String(key)] ?? String(key ?? '—');
}

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

export interface TaskCommentsPanelProps {
  /** Task UUID */
  taskId: string;
  /** Workspace workers (for avatar resolution of comment authors) */
  workers: { id: string; avatarUrl?: string; displayName?: string }[];
  /** Current user's worker ID — own comments render avatar on the right */
  currentUserId?: string;
}

export function TaskCommentsPanel({ taskId, workers, currentUserId }: TaskCommentsPanelProps) {
  const [items, setItems] = useState<TaskFeedItem[]>([]); // ascending by created_at
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // ── Load first page ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHasMore(false);
    getTaskFeed(taskId).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
        setItems([]);
      } else {
        // RPC returns newest-first → render chronologically (newest at bottom)
        setItems([...res.items].reverse());
        setHasMore(res.hasMore);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // ── Live updates via server-side broadcast ─────────────────────────────────
  useEffect(() => {
    const supabase = getClient();
    const channel = supabase
      .channel(`task-comments-${taskId}`)
      .on('broadcast', { event: 'comment_created' }, ({ payload }: { payload: unknown }) => {
        const item = (payload as { item?: TaskFeedItem } | null)?.item;
        if (!item?.item_id) return;
        setItems((prev) => {
          // Dedupe: the author's own POST response may have added it already
          if (prev.some((i) => i.item_id === item.item_id)) return prev;
          // The broadcast can arrive before the POST response — replace the
          // pending optimistic row (same author + body) instead of appending
          // a duplicate
          const pendingIdx = prev.findIndex(
            (i) =>
              i.payload?.pending === true &&
              i.author_id === item.author_id &&
              i.body === item.body,
          );
          if (pendingIdx !== -1) {
            const next = [...prev];
            next[pendingIdx] = item;
            return next;
          }
          return [...prev, item];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId]);

  // ── Load more (older) ──────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    const oldest = items[0];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const res = await getTaskFeed(taskId, {
      createdAt: oldest.created_at,
      itemId: oldest.item_id,
    });
    if (res.error) {
      setError(res.error);
    } else {
      const older = [...res.items].reverse();
      setItems((prev) => [...older, ...prev]);
      setHasMore(res.hasMore);
    }
    setLoadingMore(false);
  }, [taskId, items, loadingMore]);

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
    setItems((prev) => [
      ...prev,
      {
        item_id: tempId,
        kind: 'comment',
        author_id: currentUserId ?? null,
        author_name: ownName,
        author_type: 'human',
        body: trimmed,
        created_at: new Date().toISOString(),
        edited_at: null,
        payload: { pending: true },
      },
    ]);
    setText('');

    const res = await createComment(taskId, trimmed);
    if (res.error || !res.item) {
      // Roll back the optimistic row
      setItems((prev) => prev.filter((i) => i.item_id !== tempId));
      setText(trimmed); // restore the draft
      setSendError(res.error || 'Не удалось отправить комментарий');
    } else {
      // Replace the temp row with the server row (dedupe against broadcast)
      setItems((prev) => {
        const withoutTemp = prev.filter((i) => i.item_id !== tempId);
        if (withoutTemp.some((i) => i.item_id === res.item!.item_id)) {
          return withoutTemp;
        }
        return [...withoutTemp, res.item!];
      });
    }
    setSending(false);
  }, [text, sending, taskId, currentUserId, workers]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const avatarFor = (item: TaskFeedItem): string | undefined => {
    if (!item.author_id) return undefined;
    return workers.find((w) => w.id === item.author_id)?.avatarUrl;
  };

  const canSend = text.trim().length > 0 && !sending;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Feed */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-text-muted">Загрузка…</div>
        ) : error ? (
          <div className="py-8 text-center text-[13px] text-text-muted">{error}</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-muted">
            Комментариев пока нет
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="mx-auto mb-3 block text-[12px] text-text-muted underline-offset-2 hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Загрузка…' : 'Показать более старые'}
              </button>
            )}

            <div className="flex flex-col gap-4">
              {items.map((item) => {
                // ── System status line (single centered row, no bubble) ──
                if (item.kind === 'status') {
                  const from = columnLabel(item.payload?.from_column);
                  const to = columnLabel(item.payload?.to_column);
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
                      style={isPending ? { opacity: 0.5 } : undefined}
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

      {/* Composer */}
      <div className="border-t border-white/10 px-4 py-3">
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
