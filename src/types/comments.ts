/**
 * Types for the task "Comments" tab feed (AGENT-08).
 *
 * The feed is produced by the RPC `get_task_feed` (migration 076) and merges
 * three sources (decision R5, docs/decisions.md ADR-2026-09-06):
 *  - task_comments        → kind 'comment' (durable: humans + agents)
 *  - task_column_history  → kind 'status'  (durable: column moves)
 *  - agent_events         → kind 'agent'   (transient: last 7 days)
 *
 * `task_events` is intentionally NOT part of the UI feed (nobody writes
 * status_change/assignment there; comments live in task_comments now).
 */

/** One merged feed row (RPC get_task_feed output). */
export interface TaskFeedItem {
  /** Source row id (uuid as text) — used for keyset pagination */
  item_id: string;
  /** Discriminator of the feed row source */
  kind: 'comment' | 'status' | 'agent';
  /** workers.id (NULL for system rows / agent events) */
  author_id: string | null;
  /** Denormalized display name (snapshot at insert time) */
  author_name: string;
  /** 'human' → avatar, 'agent' → ◆, 'system' → status line */
  author_type: 'human' | 'agent' | 'system';
  /** Comment text / agent summary / NULL for status rows */
  body: string | null;
  created_at: string;
  edited_at: string | null;
  /** kind-specific extras (source, from_column/to_column, tool, …) */
  payload: Record<string, unknown> | null;
}

/** GET /api/tasks/[id]/comments response */
export interface TaskFeedResponse {
  items: TaskFeedItem[];
  /** true when another page (older items) is likely available */
  has_more: boolean;
}

/** POST /api/tasks/[id]/comments response — the created comment as a feed item */
export interface CreateCommentResponse {
  item: TaskFeedItem;
}

/** API-layer result wrappers (pattern of src/lib/api/flow.ts) */
export interface TaskFeedResult {
  items: TaskFeedItem[];
  hasMore: boolean;
  error: string | null;
}

export interface CreateCommentResult {
  item: TaskFeedItem | null;
  error: string | null;
}
