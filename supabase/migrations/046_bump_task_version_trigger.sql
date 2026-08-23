-- ============================================================================
-- 046_bump_task_version_trigger.sql
-- INV-09: version на tasks инкрементируется атомарно при каждом UPDATE.
--
-- Проблема: moveTask делает optimistic lock (WHERE version = N), но НИКТО
--   не инкрементировал version → после первого успешного move версия
--   оставалась прежней, и все последующие move падали с version_conflict.
-- Решение: BEFORE UPDATE триггер, атомарно инкрементирующий version.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bump_task_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Атомарный инкремент при любой мутации строки задачи (INV-09).
  -- Явно переданный NEW.version перезаписывается OLD.version + 1,
  -- что гарантирует монотонность и отсутствие race conditions.
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_task_version ON public.tasks;
CREATE TRIGGER trg_bump_task_version
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.bump_task_version();

-- Проверка: триггер зарегистрирован
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'trg_bump_task_version';