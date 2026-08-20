-- ============================================================================
-- 039_task_assignment_notify.sql
-- Уведомление при назначении исполнителя на задачу (Feature 1)
--
-- 1. Триггер trg_task_assignment_notify: при изменении assigned_to
--    (с NULL на значение или с одного на другого) ставит запись
--    в enrichment_queue (type='bot_notify', alert_type='task_assignment').
-- 2. Расширение дефолта notification_settings в workspace_telegram_chats:
--    on_task_assignment = true (личные уведомления исполнителю).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Триггер уведомления о назначении исполнителя
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Срабатывает только когда assigned_to реально изменился
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',   'task_assignment',
        'task_id',      NEW.id,
        'assignee_id',  NEW.assigned_to,
        'full_id',      public.task_full_id(NEW.id),
        'title',        COALESCE(NEW.metadata->>'rewritten_title', LEFT(NEW.description, 100)),
        'column',       NEW.column,
        'priority',     NEW.priority,
        'deadline',     NEW.deadline
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_assignment_notify ON public.tasks;
CREATE TRIGGER trg_task_assignment_notify
AFTER UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignment();

-- ----------------------------------------------------------------------------
-- 2. Расширение дефолта notification_settings
-- ----------------------------------------------------------------------------
ALTER TABLE public.workspace_telegram_chats
  ALTER COLUMN notification_settings SET DEFAULT '{
    "on_inbox_move": false,
    "on_overload": false,
    "on_task_assignment": true,
    "on_member_added": true,
    "quiet_hours": []
  }'::jsonb;