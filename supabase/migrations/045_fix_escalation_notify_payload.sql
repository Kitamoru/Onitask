-- ============================================================================
-- 045_fix_escalation_notify_payload.sql
-- Исправление payload эскалаций для корректной работы bot-notify Edge Function
--
-- Проблема: trigger_escalation_alert кладёт в enrichment_queue payload с
--   полями 'text' и 'task_id', но bot-notify ожидает 'alert_type', 'full_id',
--   'title', 'workspace_id'.
-- Решение: перегенерировать функции триггеров с правильным payload.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Исправлённый trigger_escalation_alert
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_escalation_alert()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.needs_human = true
     AND (OLD.needs_human IS DISTINCT FROM NEW.needs_human) THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload, status, scheduled_at)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',   'escalation_alert',
        'task_id',      NEW.id,
        'full_id',      public.task_full_id(NEW.id),
        'title',        NEW.title,
        'escalation_reason', COALESCE(NEW.escalation_reason, 'не указана'),
        'workspace_id', NEW.workspace_id
      ),
      'pending',
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_escalation_alert ON public.tasks;
CREATE TRIGGER trg_escalation_alert
AFTER UPDATE OF needs_human ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.trigger_escalation_alert();

-- ----------------------------------------------------------------------------
-- 2. Исправлённый trigger_resolution_notify
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_resolution_notify()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.needs_human = true AND NEW.needs_human = false THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload, status, scheduled_at)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type', 'escalation_resolved',
        'task_id',    NEW.id,
        'full_id',    public.task_full_id(NEW.id),
        'title',      NEW.title,
        'workspace_id', NEW.workspace_id
      ),
      'pending',
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolution_notify ON public.tasks;
CREATE TRIGGER trg_resolution_notify
AFTER UPDATE OF needs_human ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.trigger_resolution_notify();

-- ----------------------------------------------------------------------------
-- 3. Проверка: показать pending bot_notify записи (для отладки)
-- ----------------------------------------------------------------------------
-- SELECT eq.id, eq.payload, eq.status
-- FROM public.enrichment_queue eq
-- WHERE eq.type = 'bot_notify' AND eq.status = 'pending'
-- ORDER BY eq.created_at DESC
-- LIMIT 10;