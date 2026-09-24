-- ============================================================================
-- 100_update_comment_constraint_system_source.sql
-- Источники task_comments: системные/ревью/кронные комментарии.
--
-- Проблема: CHECK разрешал только ('twa', 'mcp', 'telegram'), поэтому
-- системные записи (эскалации, исходы проверки, cron-сводки) падали 23514.
--
-- Идемпотентно (DROP ... IF EXISTS + ADD). Применено в БД как migration
-- 20260924185837; файл добавлен для воспроизводимости репозитория.
-- ============================================================================

ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_source_check;
ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_source_check
  CHECK (source IN ('twa', 'mcp', 'telegram', 'system', 'review', 'cron'));
