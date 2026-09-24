-- ============================================================================
-- 103_filter_stale_escalation_nack_detail.sql
-- Stage 15: не показывать устаревшую причину предыдущей попытки.
--
-- `tasks.metadata.nack_reason` / `nack_detail` описывают отказ агента. Они
-- релевантны только для эскалаций `max_attempts` (после трёх отказов) и
-- `unsupported_task` (агент явно отказался выполнять задачу). При других
-- причинах (`conflicting_requirements`, handoff и т.д.) значения могут
-- остаться от предыдущей попытки, поэтому в alert payload их нельзя
-- пробрасывать.
--
-- Идемпотентно (CREATE OR REPLACE). Применено через Supabase MCP как
-- migration 20260924201831; файл сохранён для воспроизводимости репозитория.
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
        'alert_type',        'escalation_alert',
        'task_id',           NEW.id,
        'full_id',           public.task_full_id(NEW.id),
        'title',             NEW.title,
        'escalation_reason', COALESCE(NEW.escalation_reason, 'не указана'),
        'suggested_action',  NEW.metadata->>'suggested_action',
        'nack_reason',       CASE
          WHEN NEW.escalation_reason IN ('max_attempts', 'unsupported_task')
            THEN NEW.metadata->>'nack_reason'
          ELSE NULL
        END,
        'nack_detail',       CASE
          WHEN NEW.escalation_reason IN ('max_attempts', 'unsupported_task')
            THEN NEW.metadata->>'nack_detail'
          ELSE NULL
        END,
        'workspace_id',      NEW.workspace_id
      ),
      'pending',
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
