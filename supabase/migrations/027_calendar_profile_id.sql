-- Migration: calendar — switch to profile_id (onitask v0.14.1)
-- Упрощение: calendar_connections и calendar_events привязаны к profiles.id
-- вместо worker_id/workspace_id. Личный календарь пользователя.
-- Master Spec §6.19, onitask_calendar_.md §4

-- ═══════════════════════════════════════════════════════
-- 1. calendar_connections: worker_id → profile_id
-- ═══════════════════════════════════════════════════════

-- Drop old policies
DROP POLICY IF EXISTS calendar_connections_select_policy ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_connections_insert_policy ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_connections_update_policy ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_connections_delete_policy ON public.calendar_connections;

-- Drop old unique constraint
ALTER TABLE public.calendar_connections
  DROP CONSTRAINT IF EXISTS uq_calendar_connections_worker_provider;

-- Add profile_id column
ALTER TABLE public.calendar_connections
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Backfill from workers (source_id = profiles.id::text)
UPDATE public.calendar_connections cc
SET profile_id = w.source_id::uuid
FROM public.workers w
WHERE cc.worker_id = w.id
  AND cc.profile_id IS NULL;

-- Drop worker_id column
ALTER TABLE public.calendar_connections
  DROP COLUMN IF EXISTS worker_id;

-- New unique constraint (profile + provider)
ALTER TABLE public.calendar_connections
  ADD CONSTRAINT uq_calendar_connections_profile_provider UNIQUE (profile_id, provider);

-- ═══════════════════════════════════════════════════════
-- 2. calendar_events: workspace_id → profile_id
-- ═══════════════════════════════════════════════════════

-- Drop old policies
DROP POLICY IF EXISTS calendar_events_select_policy ON public.calendar_events;
DROP POLICY IF EXISTS calendar_events_insert_policy ON public.calendar_events;
DROP POLICY IF EXISTS calendar_events_update_policy ON public.calendar_events;
DROP POLICY IF EXISTS calendar_events_delete_policy ON public.calendar_events;

-- Drop old unique constraint
ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS uq_calendar_events_remote;

-- Add profile_id column
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Backfill from workers (human workers in same workspace)
UPDATE public.calendar_events ce
SET profile_id = w.source_id::uuid
FROM public.workers w
WHERE ce.workspace_id = w.workspace_id
  AND w.type = 'human'
  AND ce.profile_id IS NULL;

-- Drop workspace_id column
ALTER TABLE public.calendar_events
  DROP COLUMN IF EXISTS workspace_id;

-- New unique constraint (profile + provider + remote_event_id)
ALTER TABLE public.calendar_events
  ADD CONSTRAINT uq_calendar_events_profile_remote UNIQUE (profile_id, provider, remote_event_id);

-- ═══════════════════════════════════════════════════════
-- 3. Drop obsolete helper functions
-- ═══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.current_worker_workspace_ids();
DROP FUNCTION IF EXISTS public.worker_workspace_id(uuid);

-- ═══════════════════════════════════════════════════════
-- 4. New RLS policies (simple: profile_id = auth.uid())
-- ═══════════════════════════════════════════════════════

-- calendar_connections
CREATE POLICY calendar_connections_select_policy ON public.calendar_connections
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY calendar_connections_insert_policy ON public.calendar_connections
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY calendar_connections_update_policy ON public.calendar_connections
  FOR UPDATE USING (profile_id = auth.uid());

CREATE POLICY calendar_connections_delete_policy ON public.calendar_connections
  FOR DELETE USING (profile_id = auth.uid());

-- calendar_events
CREATE POLICY calendar_events_select_policy ON public.calendar_events
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY calendar_events_insert_policy ON public.calendar_events
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY calendar_events_update_policy ON public.calendar_events
  FOR UPDATE USING (profile_id = auth.uid());

CREATE POLICY calendar_events_delete_policy ON public.calendar_events
  FOR DELETE USING (profile_id = auth.uid());

-- ═══════════════════════════════════════════════════════
-- 5. Update indexes
-- ═══════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_calendar_events_workspace_date;
DROP INDEX IF EXISTS idx_calendar_events_provider;
DROP INDEX IF EXISTS idx_calendar_events_reminder_pending;

CREATE INDEX idx_calendar_events_profile_date
  ON public.calendar_events (profile_id, start_at, end_at);

CREATE INDEX idx_calendar_events_profile_provider
  ON public.calendar_events (profile_id, provider);

CREATE INDEX idx_calendar_events_reminder_pending
  ON public.calendar_events (profile_id, start_at)
  WHERE reminder_minutes_before IS NOT NULL;

-- ═══════════════════════════════════════════════════════
-- 6. Update reminder trigger (use profile_id)
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_schedule_calendar_reminder()
RETURNS TRIGGER AS $$
DECLARE
  v_scheduled_at timestamptz;
  v_existing_job_id uuid;
BEGIN
  -- Пропускаем если reminder_minutes_before IS NULL или событие уже прошло
  IF NEW.reminder_minutes_before IS NULL THEN
    RETURN NEW;
  END IF;
  
  IF NEW.start_at <= NOW() THEN
    RETURN NEW;
  END IF;
  
  -- Вычисляем время напоминания
  v_scheduled_at := NEW.start_at - (NEW.reminder_minutes_before || ' minutes')::interval;
  
  -- Удаляем устаревший pending job для этого события (если время изменилось)
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
  
  -- Создаём новый job в очереди (profile_id вместо worker_id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════
-- 7. Update comments
-- ═══════════════════════════════════════════════════════

COMMENT ON TABLE public.calendar_connections IS
  'Подключённые внешние календари (Yandex CalDAV, Outlook Graph API). Per-profile connection. Токены зашифрованы AES-256-GCM (INV-17).';

COMMENT ON TABLE public.calendar_events IS
  'События из внешних календарей (синхронизированные через Edge Function calendar_sync). Per-profile (личный календарь).';