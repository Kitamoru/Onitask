-- ============================================================
-- onitask · Bot Task Drafts — Consume Latest Migration
-- File:    031_bot_task_draft_consume_latest.sql
-- Version: 1.0.0
-- Date:    2026-08-15
-- Purpose: Fix BUTTON_DATA_INVALID (Telegram callback_data limit 64 bytes)
--          by removing draft UUID from callback_data and using
--          a new RPC to consume the latest draft by chat_id instead.
-- Master:  supabase/migrations/030_bot_task_drafts.sql
-- ============================================================

-- 31.1 RPC: consume latest active draft for a given chat_id
-- Returns the most recent non-expired draft and deletes it atomically.
-- Used when user selects a board after /task flow — no draftId in callback_data.
CREATE OR REPLACE FUNCTION public.consume_latest_bot_task_draft(
  p_chat_id bigint
)
RETURNS TABLE (
  user_id uuid,
  chat_id bigint,
  title text,
  description text,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row bot_task_drafts%ROWTYPE;
BEGIN
  -- Атомарно читаем и удаляем последний активный черновик для чата
  DELETE FROM public.bot_task_drafts
  WHERE id = (
    SELECT id FROM public.bot_task_drafts
    WHERE chat_id = p_chat_id
      AND expires_at > now()
      AND source != 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  )
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- Черновик не найден или истёк — возвращаем пустую строку
    RETURN QUERY SELECT NULL::uuid, NULL::bigint, NULL::text, NULL::text, NULL::text;
  ELSE
    RETURN QUERY SELECT v_row.user_id, v_row.chat_id, v_row.title, v_row.description, v_row.source;
  END IF;
END;
$$;