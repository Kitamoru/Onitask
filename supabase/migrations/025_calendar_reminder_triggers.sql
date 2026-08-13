-- Migration: calendar reminder triggers (onitask v0.14.0)
-- Модуль «Календарь» — автоматическое планирование/отмена напоминаний
-- Master Spec §6.19, onitask_calendar_.md §5
-- 
-- Триггеры:
-- - trg_schedule_calendar_reminder: при INSERT/UPDATE события создаёт job в enrichment_queue
-- - trg_cancel_calendar_reminder: при DELETE события удаляет pending jobs из enrichment_queue

-- ═══════════════════════════════════════════════════════
-- 1. Функция: планирование напоминания
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_schedule_calendar_reminder()
RETURNS TRIGGER AS $$
DECLARE
  v_target_worker_id uuid;
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
  
  -- Получаем worker_id из connection (первый активный подключённый аккаунт для этого workspace)
  SELECT cc.worker_id INTO v_target_worker_id
  FROM public.calendar_connections cc
  WHERE cc.workspace_id = NEW.workspace_id
    AND cc.provider = NEW.provider
    AND cc.is_active = true
  LIMIT 1;
  
  IF v_target_worker_id IS NULL THEN
    -- Нет активного подключения — пропускаем
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
  
  -- Создаём новый job в очереди
  INSERT INTO public.enrichment_queue (
    workspace_id,
    type,
    payload,
    scheduled_at,
    status
  ) VALUES (
    NEW.workspace_id,
    'bot_notify',
    jsonb_build_object(
      'workspace_id', NEW.workspace_id::text,
      'alert_type', 'calendar_reminder',
      'event_id', NEW.id::text,
      'target_worker_id', v_target_worker_id::text
    ),
    v_scheduled_at,
    'pending'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.trg_schedule_calendar_reminder() IS
  'Триггер: при INSERT/UPDATE calendar_events создаёт job в enrichment_queue для отправки напоминания через Telegram Bot.';

-- ═══════════════════════════════════════════════════════
-- 2. Функция: отмена напоминания
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_cancel_calendar_reminder()
RETURNS TRIGGER AS $$
BEGIN
  -- Удаляем все pending/cancelled jobs для удалённого события
  UPDATE public.enrichment_queue
  SET status = 'cancelled',
      processed_at = NOW()
  WHERE payload->>'event_id' = OLD.id::text
    AND payload->>'alert_type' = 'calendar_reminder'
    AND status IN ('pending', 'processing');
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.trg_cancel_calendar_reminder() IS
  'Триггер: при DELETE calendar_events удаляет pending reminder jobs из enrichment_queue.';

-- ═══════════════════════════════════════════════════════
-- 3. Триггеры на таблице calendar_events
-- ═══════════════════════════════════════════════════════

-- Триггер планирования: BEFORE INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_schedule_calendar_reminder ON public.calendar_events;
CREATE TRIGGER trg_schedule_calendar_reminder
  BEFORE INSERT OR UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_schedule_calendar_reminder();

-- Триггер отмены: AFTER DELETE
DROP TRIGGER IF EXISTS trg_cancel_calendar_reminder ON public.calendar_events;
CREATE TRIGGER trg_cancel_calendar_reminder
  AFTER DELETE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cancel_calendar_reminder();

-- ═══════════════════════════════════════════════════════
-- 4. Индекс для быстрого поиска pending reminder jobs
-- ═══════════════════════════════════════════════════════

-- Индекс для эффективного запроса в calendar_reminder Edge Function
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_calendar_reminder_pending
  ON public.enrichment_queue (scheduled_at)
  WHERE type = 'bot_notify'
    AND status = 'pending'
    AND locked_at IS NULL;