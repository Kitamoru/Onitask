-- ============================================================================
-- 102_task_attachments_survive_execution_gc.sql
-- FILE-01: файлы задачи переживают GC task_executions.
--
-- `execution_id` нужен только для идемпотентного retry
-- (UNIQUE (execution_id, filename)). Cron `gc_ops_history` удаляет старые
-- executions, поэтому ON DELETE CASCADE из migration 077 стирал ещё и
-- манифест файла вместе с бинарником Storage.
--
-- ON DELETE SET NULL сохраняет дедупликацию, пока execution жив, и оставляет
-- артефакт доступным по task_id после GC. Колонка nullable, partial-индекс уже
-- учитывает NULL, а чтение файлов не зависит от существования execution.
--
-- Идемпотентно. Применено в Supabase как migration
-- 20260924194124; файл сохранён для воспроизводимости репозитория.
-- ============================================================================

ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_execution_id_fkey;

ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_execution_id_fkey
  FOREIGN KEY (execution_id)
  REFERENCES public.task_executions(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.task_attachments.execution_id IS
  'FILE-01: идемпотентный retry по (execution_id, filename). ON DELETE SET NULL: GC execution не удаляет манифест файла задачи (миграция 102).';
