-- Migration 033: Bot dedup_key unique index + get_task_card_data RPC
-- BOT-03: Atomic dedup via unique index (v0.6.4, §6.2)
-- BOT-03: Unified task card data source (§6.2d)

-- ============================================================================
-- 1. Add dedup_key column to tasks table
-- ============================================================================
-- dedup_key uniquely identifies a task creation intent.
-- Format: "{source}:{chat_id}:{message_id}" or "{source}:{telegram_user_id}:{inline_query_id}"
-- NULL for tasks created via TWA UI (no message origin).

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'tasks' AND column_name = 'dedup_key') THEN
    ALTER TABLE tasks ADD COLUMN dedup_key TEXT;
  END IF;
END $$;

-- Unique index: only one non-null dedup_key per value
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup_key 
  ON tasks(dedup_key) WHERE dedup_key IS NOT NULL;

-- Index for lookup by dedup_key during duplicate detection
CREATE INDEX IF NOT EXISTS idx_tasks_dedup_key_lookup 
  ON tasks(dedup_key NULLS FIRST) WHERE dedup_key IS NOT NULL;

-- ============================================================================
-- 2. get_task_card_data RPC (§6.2d)
-- ============================================================================
-- Returns all fields needed to render a unified task card.
-- Used by bot create-task flow, lookup, and duplicate detection.

CREATE OR REPLACE FUNCTION get_task_card_data(p_task_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'fullId', t.task_prefix || '-'::text || t.task_number,
  'title', t.title,
  'column', t.column,
  'isInbox', t.is_inbox,
  'isBlocked', EXISTS (
    SELECT 1 FROM task_relations tr
    JOIN tasks dep ON dep.id = tr.source_task_id
    WHERE tr.target_task_id = t.id AND dep.column != 'done'
  ),
  'priority', CASE 
    WHEN t.priority IN ('critical', 'high') THEN 'high'
    WHEN t.priority = 'medium' THEN 'medium'
    WHEN t.priority = 'low' THEN 'low'
    ELSE null
  END,
  'dueDate', t.deadline::text,
  'assigneeName', wkr.name,
  'workspaceHandle', ws.slug,
  'clarityScore', COALESCE(
    (t.metadata->>'clarity_score')::numeric,
    null
  )
)
FROM tasks t
JOIN workspaces ws ON ws.id = t.workspace_id
LEFT JOIN workers wkr ON wkr.id = t.assigned_to
WHERE t.id = p_task_id;
$$;

-- ============================================================================
-- 3. Performance indexes
-- ============================================================================
-- Speed up dedup check (SELECT by dedup_key)
-- Speed up task lookup by full_id (already exists via find_task_by_full_id RPC)

-- Index on created_at for draft ordering
CREATE INDEX IF NOT EXISTS idx_bot_task_drafts_created_at 
  ON bot_task_drafts(created_at DESC);

-- Index on consume_latest query (status='pending' ORDER BY created_at DESC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_bot_task_drafts_pending_chat 
  ON bot_task_drafts(created_at DESC) 
  WHERE status = 'pending';