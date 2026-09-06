/**
 * Comments / task feed API client (AGENT-08).
 *
 * Uses server-side API routes (service_role + Telegram initData auth),
 * same pattern as src/lib/api/flow.ts. The client never talks to Supabase
 * directly for comments: the TWA has no Supabase JWT, so all reads/writes
 * go through /api/tasks/[id]/comments.
 *
 * Live updates are NOT handled here — see TaskCommentsPanel broadcast
 * subscription on the `task-comments-<taskId>` channel.
 */

import type {
  TaskFeedItem,
  TaskFeedResponse,
  TaskFeedResult,
  CreateCommentResult,
} from '@/types/comments';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get Telegram initData from window for API auth (same as flow.ts) */
function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

// ─── Feed ────────────────────────────────────────────────────────────────────

/**
 * GET /api/tasks/[id]/comments — merged feed (comments + status history +
 * agent events). Paginated with a keyset cursor, newest first.
 *
 * @param taskId - Task UUID
 * @param cursor - Optional pagination cursor from the previous page
 *   ({ createdAt, itemId } of the LAST item of the loaded page).
 */
export async function getTaskFeed(
  taskId: string,
  cursor?: { createdAt: string; itemId: string } | null,
): Promise<TaskFeedResult> {
  try {
    const initData = getTelegramInitData();
    if (!initData) {
      return { items: [], hasMore: false, error: 'Не авторизован' };
    }

    const params = new URLSearchParams();
    if (cursor) {
      params.set('cursor_created', cursor.createdAt);
      params.set('cursor_id', cursor.itemId);
    }
    const qs = params.toString();

    const res = await fetch(
      `/api/tasks/${taskId}/comments${qs ? `?${qs}` : ''}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-init-data': initData,
        },
      },
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      return { items: [], hasMore: false, error: errData.error || 'Failed to load comments' };
    }

    const json = (await res.json()) as TaskFeedResponse;
    return { items: json.items ?? [], hasMore: !!json.has_more, error: null };
  } catch (err) {
    return {
      items: [],
      hasMore: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * POST /api/tasks/[id]/comments — create a comment.
 * The author is resolved server-side from initData (client value is ignored).
 */
export async function createComment(
  taskId: string,
  text: string,
): Promise<CreateCommentResult> {
  try {
    const initData = getTelegramInitData();

    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(initData ? { 'x-init-data': initData } : {}),
      },
      body: JSON.stringify({ text }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { item: null, error: json.error || 'Create failed' };
    }

    return { item: json.item as TaskFeedItem, error: null };
  } catch (err) {
    return {
      item: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
