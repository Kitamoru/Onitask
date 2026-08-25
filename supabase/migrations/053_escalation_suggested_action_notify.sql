-- ============================================================================
-- 053_escalation_suggested_action_notify.sql
-- Проброс suggested_action в Telegram-карточку эскалации ("Предлагаю: ...").
--
-- Проблема: пользователь в боте видит "Причина: Out_of_scope", но не видит
--   решение агента (suggested_action). Поле жило только в agent_events.
-- Решение: escalate_task теперь пишет suggested_action в tasks.metadata,
--   триггер кладёт его в payload bot_notify, бот рендерит строку.
-- ============================================================================

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
        'suggested_action',  NEW.metadata->>'suggested_action',
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