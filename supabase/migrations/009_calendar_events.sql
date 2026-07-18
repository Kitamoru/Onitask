-- Migration: calendar_events (onitask v0.14.0)
-- Модуль «Календарь» — интеграция внешних календарей (Yandex, Outlook)
-- Master Spec §6.19, onitask_calendar_.md

-- ═══════════════════════════════════════════════════════
-- 1. Таблица calendar_connections
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('yandex', 'outlook')),
  provider_account_email text NOT NULL,
  encrypted_oauth_tokens bytea NOT NULL,
  token_expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  
  -- Уникальность по комбинации для upsert
  CONSTRAINT uq_calendar_connections UNIQUE (workspace_id, worker_id, provider)
);

COMMENT ON TABLE public.calendar_connections IS
  'Подключённые внешние календари (Yandex CalDAV, Outlook Graph API). Токены зашифрованы AES-256-GCM (INV-17).';

COMMENT ON COLUMN public.calendar_connections.encrypted_oauth_tokens IS
  'Зашифрованные OAuth токены (AES-256-GCM). Расшифровка только внутри Edge Functions.';

-- ═══════════════════════════════════════════════════════
-- 2. Таблица calendar_events
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('yandex', 'outlook')),
  remote_event_id text NOT NULL,
  title text NOT NULL,
  description text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reminder_minutes_before int DEFAULT 15 CHECK (reminder_minutes_before IS NULL OR (reminder_minutes_before >= 0 AND reminder_minutes_before <= 1440)),
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  source_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Уникальность по комбинации для upsert
  CONSTRAINT uq_calendar_events_remote UNIQUE (workspace_id, provider, remote_event_id)
);

COMMENT ON TABLE public.calendar_events IS
  'События из внешних календарей (синхронизированные через Edge Function calendar_sync).';

COMMENT ON COLUMN public.calendar_events.reminder_minutes_before IS
  'Напоминание за N минут до события. NULL = без напоминания. Дефолт: 15 мин.';

COMMENT ON COLUMN public.calendar_events.source_synced_at IS
  'Время последней успешной синхронизации от провайдера.';

-- ═══════════════════════════════════════════════════════
-- 3. Индексы
-- ═══════════════════════════════════════════════════════

-- Быстрый поиск событий по дате и воркспейсу
CREATE INDEX IF NOT EXISTS idx_calendar_events_workspace_date 
  ON public.calendar_events (workspace_id, start_at, end_at);

-- Поиск по провайдеру
CREATE INDEX IF NOT EXISTS idx_calendar_events_provider 
  ON public.calendar_events (workspace_id, provider);

-- Для триггера напоминаний
CREATE INDEX IF NOT EXISTS idx_calendar_events_reminder_pending 
  ON public.calendar_events (workspace_id, start_at)
  WHERE reminder_minutes_before IS NOT NULL;

-- ═══════════════════════════════════════════════════════
-- 4. Триггеры
-- ═══════════════════════════════════════════════════════

-- Автоматическое обновление updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Валидация времени событий
CREATE OR REPLACE FUNCTION public.validate_calendar_times()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_at <= NEW.start_at THEN
    RAISE EXCEPTION 'end_at must be after start_at (event: %)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_calendar_times
  BEFORE INSERT OR UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_calendar_times();

-- ═══════════════════════════════════════════════════════
-- 5. RLS политики
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- helper function
CREATE OR REPLACE FUNCTION public.current_worker_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT DISTINCT workspace_id FROM public.workers WHERE source_id = auth.uid()::text;
$$ LANGUAGE sql STABLE;

-- calendar_connections политики
DROP POLICY IF EXISTS calendar_connections_select_policy ON public.calendar_connections;
CREATE POLICY calendar_connections_select_policy ON public.calendar_connections
  FOR SELECT USING (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

DROP POLICY IF EXISTS calendar_connections_insert_policy ON public.calendar_connections;
CREATE POLICY calendar_connections_insert_policy ON public.calendar_connections
  FOR INSERT WITH CHECK (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

DROP POLICY IF EXISTS calendar_connections_update_policy ON public.calendar_connections;
CREATE POLICY calendar_connections_update_policy ON public.calendar_connections
  FOR UPDATE USING (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

DROP POLICY IF EXISTS calendar_connections_delete_policy ON public.calendar_connections;
CREATE POLICY calendar_connections_delete_policy ON public.calendar_connections
  FOR DELETE USING (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

-- calendar_events политики
DROP POLICY IF EXISTS calendar_events_select_policy ON public.calendar_events;
CREATE POLICY calendar_events_select_policy ON public.calendar_events
  FOR SELECT USING (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

DROP POLICY IF EXISTS calendar_events_insert_policy ON public.calendar_events;
CREATE POLICY calendar_events_insert_policy ON public.calendar_events
  FOR INSERT WITH CHECK (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

DROP POLICY IF EXISTS calendar_events_update_policy ON public.calendar_events;
CREATE POLICY calendar_events_update_policy ON public.calendar_events
  FOR UPDATE USING (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

DROP POLICY IF EXISTS calendar_events_delete_policy ON public.calendar_events;
CREATE POLICY calendar_events_delete_policy ON public.calendar_events
  FOR DELETE USING (workspace_id IN (SELECT * FROM public.current_worker_workspace_ids()));

-- ═══════════════════════════════════════════════════════
-- NOTE: pg_cron job для автоматической синхронизации
-- ═══════════════════════════════════════════════════════
-- Extension "cron" не доступна на этом Supabase проекте.
-- Для включения автоматической синхронизации календаря:
--
-- 1. Включите extension cron в Supabase Dashboard → Database → Extensions
-- 2. Раскомментируйте код ниже и примените отдельной миграцией:
--
-- CREATE EXTENSION IF NOT EXISTS cron SCHEMA public;
--
-- SELECT cron.schedule('calendar_sync_job', '*/15 * * * *', $$
--   SELECT http_post(
--     get_edge_fn_url() || '/functions/v1/calendar-sync',
--     '{"action":"sync_all"}'::jsonb,
--     ARRAY[FORMAT('Authorization: Bearer %s', current_setting('app.edge_fn_secret'))],
--     200
--   )
-- $$);
--
-- Альтернатива: использовать Supabase Cron Jobs из Dashboard
-- Command: curl -X POST $SUPABASE_URL/functions/v1/calendar-sync \
--   -H "Authorization: Bearer $EDGE_FUNCTION_SECRET" \
--   -H "Content-Type: application/json" \
--   -d '{"action":"sync_all"}'
-- Schedule: */15 * * * *
