-- ============================================================================
-- 121_security_definer_search_path.sql
-- onitask · Фиксированный search_path для SECURITY DEFINER функций
--
-- Находка (2026-09-26, live-SQL аудит): 6 функций объявлены
-- SECURITY DEFINER, но без `SET search_path`.
--
-- Почему это единственная находка из advisor-батча, которую стоит чинить.
-- Остальные «function_search_path_mutable» (WARN, 38 штук) — обычные
-- функции без эскалации прав: подмена объекта в их search_path не даёт
-- ничего, кроме неаккуратности. Здесь ситуация другая:
--
--   SECURITY DEFINER исполняется от имени владельца (postgres), а
--   search_path определяет, ЧТО именно подставится на имя. Если атакующий
--   может создать объект в одном из каталогов search_path (например,
--   `public`, куда пишут все, кто может создать таблицу), он подставляет
--   свою таблицу/функцию, и она вызывается с правами postgres.
--
-- Все 6 функций ниже уже используют ПОЛНОСТЬЮ квалифицированные ссылки
-- (`public.bot_task_drafts`, `public.enrichment_queue`), поэтому установка
-- search_path = public ничего не меняет по семантике — это чистое
-- закрепление уже существующего поведения. Проверено построчно перед
-- применением.
--
-- Затрагивается только область поиска имён. Права, тела функций,
-- владелец (postgres) и поведение не меняются.
--
-- Про `trg_schedule_calendar_reminder`: календарный контур ещё не
-- подключён (триггеры на calendar_events не установлены, см. DB-20b), но
-- функция объявлена SECURITY DEFINER и лежит в общей схеме — фиксируем
-- и её, чтобы при установке триггеров дыра не появилась задним числом.
-- ============================================================================

-- 1. Черновики задач из Telegram -------------------------------------------

CREATE OR REPLACE FUNCTION public.create_bot_task_draft(
  p_user_id uuid,
  p_chat_id bigint,
  p_title text,
  p_description text DEFAULT NULL::text,
  p_source text DEFAULT 'bot'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_draft_id uuid;
BEGIN
  INSERT INTO public.bot_task_drafts (user_id, chat_id, title, description, source, expires_at)
  VALUES (p_user_id, p_chat_id, p_title, p_description, p_source, now() + interval '10 minutes')
  RETURNING id INTO v_draft_id;
  RETURN v_draft_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_bot_task_draft(p_draft_id uuid)
RETURNS TABLE(user_id uuid, chat_id bigint, title text, description text, source text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_row public.bot_task_drafts%ROWTYPE;
BEGIN
  DELETE FROM public.bot_task_drafts WHERE id = p_draft_id AND expires_at > now() RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::bigint, NULL::text, NULL::text, NULL::text;
  ELSE
    RETURN QUERY SELECT v_row.user_id, v_row.chat_id, v_row.title, v_row.description, v_row.source;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_latest_bot_task_draft(p_chat_id bigint)
RETURNS TABLE(user_id uuid, chat_id bigint, title text, description text, source text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.bot_task_drafts%ROWTYPE;
BEGIN
  -- Атомарно читаем и удаляем последний активный черновик для чата
  -- NOTE: используем алиасы d/d2, т.к. RETURNS TABLE (user_id, chat_id, ...)
  -- создаёт переменные, конфликтующие с колонками таблицы (ошибка 42702 ambiguous).
  DELETE FROM public.bot_task_drafts AS d
  WHERE d.id = (
    SELECT d2.id FROM public.bot_task_drafts AS d2
    WHERE d2.chat_id = p_chat_id
      AND d2.expires_at > now()
      AND d2.source != 'pending'
    ORDER BY d2.created_at DESC
    LIMIT 1
  )
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::bigint, NULL::text, NULL::text, NULL::text;
  ELSE
    RETURN QUERY SELECT v_row.user_id, v_row.chat_id, v_row.title, v_row.description, v_row.source;
  END IF;
END;
$function$;

-- 2. GC-функции (вызываются из cron-ов bot-attach-ttl / purge-expired-bot-task-drafts)

CREATE OR REPLACE FUNCTION public.purge_expired_bot_attach_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.bot_attach_pending
  WHERE expires_at < now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_expired_bot_task_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.bot_task_drafts WHERE expires_at < now();
END;
$function$;

-- 3. Календарные напоминания (триггер пока не установлен — см. DB-20b)

CREATE OR REPLACE FUNCTION public.trg_schedule_calendar_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_scheduled_at timestamptz;
  v_existing_job_id uuid;
BEGIN
  IF NEW.reminder_minutes_before IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.start_at <= NOW() THEN
    RETURN NEW;
  END IF;

  v_scheduled_at := NEW.start_at - (NEW.reminder_minutes_before || ' minutes')::interval;

  SELECT eq.id INTO v_existing_job_id
  FROM public.enrichment_queue eq
  WHERE eq.payload->>'event_id' = NEW.id::text
    AND eq.payload->>'alert_type' = 'calendar_reminder'
    AND eq.status = 'pending';

  IF v_existing_job_id IS NOT NULL THEN
    UPDATE public.enrichment_queue
    SET status = 'cancelled',
        processed_at = NOW()
    WHERE id = v_existing_job_id;
  END IF;

  INSERT INTO public.enrichment_queue (
    workspace_id,
    type,
    payload,
    scheduled_at,
    status
  ) VALUES (
    (SELECT workspace_id FROM public.workers WHERE source_id = NEW.profile_id::text LIMIT 1),
    'bot_notify',
    jsonb_build_object(
      'profile_id', NEW.profile_id::text,
      'alert_type', 'calendar_reminder',
      'event_id', NEW.id::text
    ),
    v_scheduled_at,
    'pending'
  );

  RETURN NEW;
END;
$function$;
