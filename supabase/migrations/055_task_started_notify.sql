-- ============================================================================
-- 055_task_started_notify.sql
-- Уведомление постановщику, когда агент берёт его задачу в работу.
--
-- Паттерн 048: триггер trg_task_started_notify по переходу колонки в
--   'in_progress' ставит bot_notify джобу с alert_type='task_started'.
-- Отличия от 048:
--   - джоба ставится ТОЛЬКО если исполнителем стал агент
--     (workers.type = 'agent'), чтобы не спамить при перемещениях людьми;
--   - получатель — постановщик (tasks.created_by); если задачу создал агент
--     или у постановщика нет telegram_id, Edge Function bot-notify
--     автоматически падает на овнеров/админов воркспейса.
-- Сообщение (рендерится в bot-notify):
--   ⚙️ Задача <ONI-42> взята агентом "<display_name>" в работу
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_task_started()
RETURNS TRIGGER AS $$
DECLARE
  v_worker_type text;
BEGIN
  -- Срабатывает только при реальном переходе в in_progress (не из in_progress)
  IF NEW."column" = 'in_progress' AND OLD."column" IS DISTINCT FROM 'in_progress' THEN
    -- Уведомляем только когда задачу забрал агент
    SELECT type INTO v_worker_type
    FROM public.workers
    WHERE id = NEW.assigned_to;

    IF v_worker_type = 'agent' THEN
      INSERT INTO public.enrichment_queue (workspace_id, type, payload)
      VALUES (
        NEW.workspace_id,
        'bot_notify',
        jsonb_build_object(
          'alert_type', 'task_started',
          'task_id',    NEW.id,
          'full_id',    public.task_full_id(NEW.id),
          'created_by', NEW.created_by,
          'claimed_by', NEW.assigned_to
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_started_notify ON public.tasks;
CREATE TRIGGER trg_task_started_notify
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_task_started();

-- Проверка: триггер зарегистрирован
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'trg_task_started_notify';