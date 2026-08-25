-- ============================================================================
-- 051_review_fix_reason.sql
-- Причина возврата задачи на доработку (двухшаговый UX в Telegram).
--
-- Проблема: кнопка «🔧 Вернуть на доработку» двигала задачу review → in_progress
--   сразу, без причины — агент получал только сигнал fix_requests без контекста,
--   что именно переделывать.
-- Решение:
--   1) review_action принимает p_reason: при action='fix' атомарно пишет
--      metadata.last_fix_reason (читается агентом через get_task_context).
--   2) Таблица bot_review_fix_pending — pending-состояние «ждём текст причины»
--      между нажатием кнопки и следующим сообщением пользователя в чате
--      (по паттерну bot_task_drafts source='pending', миграции 030–038).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. review_action: параметр p_reason (обратная совместимость — DEFAULT NULL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_action(
  p_task_id uuid,
  p_action text,
  p_version integer,
  p_actor_worker_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace_id   uuid;
  v_column         text;
  v_reviewer_id    uuid;
  v_version        int;
  v_review_pending text;
  v_new_column     text;
  v_metadata       jsonb;
BEGIN
  IF p_action NOT IN ('approve', 'fix') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END IF;

  SELECT workspace_id, "column", reviewer_id, version,
         metadata->>'review_pending', metadata
    INTO v_workspace_id, v_column, v_reviewer_id, v_version, v_review_pending, v_metadata
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- Оптимистическая блокировка по версии (INV-09)
  IF v_version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('success', false, 'error', 'version_conflict');
  END IF;

  -- Задача должна быть в review
  IF v_column IS DISTINCT FROM 'review' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;

  -- Для задач без reviewer: одобрение должно быть ещё не выполнено
  IF v_reviewer_id IS NULL
     AND COALESCE(v_review_pending, 'false') <> 'true' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;

  -- Авторизация: активный human-worker workspace задачи (A-08)
  IF NOT EXISTS (
    SELECT 1 FROM public.workers
    WHERE id = p_actor_worker_id
      AND workspace_id = v_workspace_id
      AND type = 'human'
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_new_column := CASE p_action WHEN 'approve' THEN 'done' ELSE 'in_progress' END;

  -- Причина доработки → metadata.last_fix_reason (канал 2, персистентный)
  v_metadata := COALESCE(v_metadata, '{}'::jsonb) - 'review_pending';
  IF p_action = 'fix' AND p_reason IS NOT NULL THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{last_fix_reason}',
      to_jsonb(left(p_reason, 2000))
    );
  END IF;

  UPDATE public.tasks
  SET "column"  = v_new_column,
      metadata  = v_metadata,
      updated_at = now()
  WHERE id = p_task_id
    AND version = p_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'version_conflict');
  END IF;

  RETURN jsonb_build_object(
    'success',   true,
    'task_id',   p_task_id,
    'new_column', v_new_column
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. bot_review_fix_pending — «ждём текст причины» после нажатия 🔧
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_review_fix_pending (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id           uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  chat_id           bigint      NOT NULL,
  card_message_id   bigint      NOT NULL,
  telegram_user_id  bigint      NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  CONSTRAINT bot_review_fix_pending_task_unique UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_review_fix_pending_chat
  ON bot_review_fix_pending(chat_id);

-- Служебная таблица бота: RLS включён, политик нет — доступ только у service role
ALTER TABLE public.bot_review_fix_pending ENABLE ROW LEVEL SECURITY;