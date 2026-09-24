-- ============================================================================
-- 101_allow_hosted_runtime_task_attachment_source.sql
-- Источники task_attachments: файлы хостед-рантайма (Stage 15, вариант A).
--
-- Проблема: CHECK разрешал только ('twa', 'telegram', 'mcp'). Хостед-рантайм
-- (`agent-runtime`) забирает файлы из JSON-ответа агента и пишет манифест сам —
-- без своего маркера источник не отличить от MCP-пути при разборе инцидентов.
--
-- Идемпотентно (DROP ... IF EXISTS + ADD). Применено в БД как migration
-- 20260924185855; файл добавлен для воспроизводимости репозитория.
-- ============================================================================

ALTER TABLE public.task_attachments DROP CONSTRAINT IF EXISTS task_attachments_source_check;
ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_source_check
  CHECK (source IN ('twa', 'telegram', 'mcp', 'hosted_runtime'));
