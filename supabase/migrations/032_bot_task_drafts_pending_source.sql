-- ============================================================
-- onitask · Bot Task Drafts — Pending Source Migration
-- File:    032_bot_task_drafts_pending_source.sql
-- Version: 1.0.0
-- Date:    2026-08-15
-- Purpose: Allow source='pending' in bot_task_drafts.
--          The pending marker row (title='__PENDING_TASK__') is inserted
--          by setPendingTask() to signal the webhook to expect the next
--          message as the task description. The original CHECK constraint
--          (030) only allowed ('nl','voice','manual','mcp','bot').
-- Master:  supabase/migrations/030_bot_task_drafts.sql
-- ============================================================

-- 32.1 Drop old CHECK constraint and re-add with 'pending' allowed
ALTER TABLE public.bot_task_drafts
  DROP CONSTRAINT IF EXISTS bot_task_drafts_source_check;

ALTER TABLE public.bot_task_drafts
  ADD CONSTRAINT bot_task_drafts_source_check
  CHECK (source IN ('nl', 'voice', 'manual', 'mcp', 'bot', 'pending'));