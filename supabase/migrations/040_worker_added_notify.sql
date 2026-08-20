-- ============================================================================
-- 040_worker_added_notify.sql
-- Уведомление при добавлении human-участника в workspace (Feature 2)
--
-- Триггер trg_worker_added_notify: при INSERT в workers с type='human'
-- ставит запись в enrichment_queue (type='bot_notify', alert_type='member_added').
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_worker_added()
RETURNS TRIGGER AS $$
BEGIN
  -- Уведомляем только о добавлении человека (не агента)
  IF NEW.type = 'human' THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',   'member_added',
        'worker_id',    NEW.id,
        'workspace_id', NEW.workspace_id,
        'display_name', NEW.display_name,
        'role',         NEW.role
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_worker_added_notify ON public.workers;
CREATE TRIGGER trg_worker_added_notify
AFTER INSERT ON public.workers
FOR EACH ROW EXECUTE FUNCTION public.notify_worker_added();