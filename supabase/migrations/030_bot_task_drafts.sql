-- ============================================================
-- onitask · Bot Task Drafts Migration
-- File:    030_bot_task_drafts.sql
-- Version: 1.0.0
-- Date:    2026-08-15
-- Purpose: Store task drafts created via Telegram bot before workspace selection
--          Enables serverless-safe workflow: /task [text] → select board → create task
-- Master:  onitask_Architecture_Master_.md v0.13.2
-- ============================================================

-- 30.1 bot_task_drafts
-- Черновики задач, созданные через Telegram бот до выбора доски.
-- Пользователь вводит текст задачи → черновик сохраняется в БД → выбирает доску → задача создаётся.
CREATE TABLE public.bot_task_drafts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id       bigint      NOT NULL,              -- Telegram chat ID для маршрутизации ответа
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description   text        CHECK (char_length(description) <= 5000),
  source        text        NOT NULL DEFAULT 'bot' CHECK (source IN ('nl', 'voice', 'manual', 'mcp', 'bot')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);

-- Индекс по user_id для поиска активных черновиков
CREATE INDEX idx_bot_task_drafts_user_id ON public.bot_task_drafts (user_id, expires_at DESC);
-- Индекс по chat_id для маршрутизации
CREATE INDEX idx_bot_task_drafts_chat_id ON public.bot_task_drafts (chat_id, expires_at DESC);
-- TTL-индекс для очистки просроченных черновиков
CREATE INDEX idx_bot_task_drafts_ttl ON public.bot_task_drafts (expires_at ASC)
  WHERE expires_at > now();

-- RLS policies
ALTER TABLE public.bot_task_drafts ENABLE ROW LEVEL SECURITY;

-- Пользователи видят только свои черновики
CREATE POLICY bot_task_drafts_owner_select ON public.bot_task_drafts
  FOR SELECT USING (auth.uid() = user_id);

-- Пользователи могут создавать свои черновики
CREATE POLICY bot_task_drafts_owner_insert ON public.bot_task_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Пользователи могут удалять свои черновики
CREATE POLICY bot_task_drafts_owner_delete ON public.bot_task_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- Service role может всё
CREATE POLICY bot_task_drafts_service_all ON public.bot_task_drafts
  FOR ALL USING (true) WITH CHECK (true);

-- 30.2 Функция очистки просроченных черновиков
-- Вызывается из pg_cron каждые 5 минут или вручную
CREATE OR REPLACE FUNCTION public.purge_expired_bot_task_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.bot_task_drafts
  WHERE expires_at < now();
END;
$$;

-- 30.3 Функция создания черновика и возврата ID
-- Используется webhook route для быстрого создания
CREATE OR REPLACE FUNCTION public.create_bot_task_draft(
  p_user_id uuid,
  p_chat_id bigint,
  p_title text,
  p_description text DEFAULT NULL,
  p_source text DEFAULT 'bot'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_draft_id uuid;
BEGIN
  INSERT INTO public.bot_task_drafts (user_id, chat_id, title, description, source, expires_at)
  VALUES (p_user_id, p_chat_id, p_title, p_description, p_source, now() + interval '10 minutes')
  RETURNING id INTO v_draft_id;
  
  RETURN v_draft_id;
END;
$$;

-- 30.4 Функция получения и удаления черновика (атомарно)
-- Используется при выборе доски — читает и удаляет черновик одной транзакцией
CREATE OR REPLACE FUNCTION public.consume_bot_task_draft(
  p_draft_id uuid
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
  -- Атомарно читаем и удаляем
  DELETE FROM public.bot_task_drafts
  WHERE id = p_draft_id
    AND expires_at > now()
  RETURNING * INTO v_row;
  
  IF v_row.id IS NULL THEN
    -- Черновик не найден или истёк — возвращаем пустую строку
    RETURN QUERY SELECT NULL::uuid, NULL::bigint, NULL::text, NULL::text, NULL::text;
  ELSE
    RETURN QUERY SELECT v_row.user_id, v_row.chat_id, v_row.title, v_row.description, v_row.source;
  END IF;
END;
$$;