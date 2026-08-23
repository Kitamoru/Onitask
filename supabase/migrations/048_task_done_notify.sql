-- ============================================================================
-- 048_task_done_notify.sql
-- Уведомление постановщику при завершении задачи (move в 'done').
--
-- Проблема: при move_task → done никто не ставил запись в enrichment_queue,
--   поэтому постановщик (tasks.created_by) не получал уведомление
--   «что сделано» в Telegram.
-- Решение: триггер trg_task_done_notify по паттерну 039:
--   при переходе колонки в 'done' ставит bot_notify джобу
--   с alert_type='task_done'. Получатель — только постановщик
--   (резолвится в Edge Function bot-notify).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_task_done()
RETURNS TRIGGER AS $$
BEGIN
  -- Срабатывает только при реальном переходе в done (не из done)
  IF NEW."column" = 'done' AND OLD."column" IS DISTINCT FROM 'done' THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',   'task_done',
        'task_id',      NEW.id,
        'full_id',      public.task_full_id(NEW.id),
        'title',        COALESCE(
                          NULLIF(NEW.title, ''),
                          NEW.metadata->>'rewritten_title',
                          LEFT(NEW.description, 100)
                        ),
        'completed_by', NEW.assigned_to,
        'created_by',   NEW.created_by
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_done_notify ON public.tasks;
CREATE TRIGGER trg_task_done_notify
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_task_done();

-- Проверка: триггер зарегистрирован
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'trg_task_done_notify';