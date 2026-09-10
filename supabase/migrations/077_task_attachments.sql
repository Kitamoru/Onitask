-- ============================================================================
-- 077_task_attachments.sql
-- onitask · FILE-01..: файлы задач — артефакты + коммуникация агент ↔ человек.
--
-- Что добавляется:
--   1. task_attachments            — артефакты задачи (Storage bucket
--      'task-attachments' + манифест). base64 живёт ТОЛЬКО в транзите
--      (MCP JSON / очередь outbox), канон хранения — бинарник в Storage.
--   2. bot_task_messages           — reply-маппинг «message_id карточки →
--      task_id» для флоу «reply + файл → прикрепить».
--   3. bot_attach_pending          — стейт attach-флоу без reply
--      («/attach + файл» → ждём full_id) + буфер файлов при /task+файлы.
--   4. telegram_message_queue      — расширение attachments/metadata для
--      исходящих файлов агента (send_message_to_chat).
--
-- RLS: task_attachments — SELECT для членов воркспейса + service-only записи;
--      bot_task_messages / bot_attach_pending — service-only
--      (прецеденты 051/056/060). Каскады от tasks(id) — ON DELETE CASCADE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. task_attachments — артефакты задачи
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id       uuid        NOT NULL REFERENCES public.tasks(id)      ON DELETE CASCADE,
  -- Привязка к execution ops_terminal: идемпотентный retry (version_conflict)
  -- не дублирует файлы (UNIQUE (execution_id, filename)).
  execution_id  uuid        REFERENCES public.task_executions(id) ON DELETE CASCADE,
  filename      text        NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 120),
  mime_type     text        NOT NULL,
  size_bytes    int         NOT NULL CHECK (size_bytes > 0),
  storage_path  text        NOT NULL, -- task-attachments/<ws>/<task>/<uuid>.<ext>
  uploaded_by   uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  author_type   text        NOT NULL CHECK (author_type IN ('human', 'agent')),
  source        text        NOT NULL DEFAULT 'twa'
                   CHECK (source IN ('twa', 'telegram', 'mcp')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_attachments_exec_filename_unique UNIQUE (execution_id, filename)
);

COMMENT ON TABLE public.task_attachments IS
  'FILE-01: артефакты задачи (манифест). Бинарник — Storage bucket task-attachments. Каскад от tasks (строки), удаление объектов из Storage — в DELETE /api/tasks/[id] + GC сирот.';

CREATE INDEX IF NOT EXISTS idx_task_attachments_task
  ON public.task_attachments (task_id);

CREATE INDEX IF NOT EXISTS idx_task_attachments_execution
  ON public.task_attachments (execution_id)
  WHERE execution_id IS NOT NULL;

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

-- Чтение — участники воркспейса (паттерн task_comments 076). Запись —
-- только service role (Route Handlers / opsTerminalCore).
CREATE POLICY task_attachments_select_member
  ON public.task_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workers w
      WHERE w.workspace_id = task_attachments.workspace_id
        AND w.is_active = true
        AND w.source_id::text = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------------
-- 2. bot_task_messages — reply-маппинг «message_id карточки → task_id»
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_task_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id       uuid        NOT NULL REFERENCES public.tasks(id)      ON DELETE CASCADE,
  chat_id       bigint      NOT NULL,
  message_id    bigint      NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_task_messages_chat_message_unique UNIQUE (chat_id, message_id)
);

COMMENT ON TABLE public.bot_task_messages IS
  'FILE-02: маппинг карточки задачи в TG (message_id) → task_id, для флоу «reply + файл → прикрепить к задаче». Пишут webhook (/task) и bot-notify (task-карточки).';

CREATE INDEX IF NOT EXISTS idx_bot_task_messages_chat
  ON public.bot_task_messages (chat_id, message_id);

-- Служебная таблица бота: RLS включён, политик нет — доступ только у service role
ALTER TABLE public.bot_task_messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. bot_attach_pending — стейт attach-флоу без reply
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_attach_pending (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chat_id           bigint      NOT NULL,
  telegram_user_id  bigint      NOT NULL,
  -- /attach без reply: ждём от пользователя full_id задачи
  task_full_id      text,
  -- Буфер загруженных файлов (metadata: filename/mime_type/size_bytes) для
  -- /task + файлы, пока задача ещё не создана. Без base64 — бинарник
  -- передаётся сразу в Storage после резолва задачи.
  file_meta         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

COMMENT ON TABLE public.bot_attach_pending IS
  'FILE-04: стейт attach-флоу в Telegram. /attach без reply → ждём full_id; /task + файлы → буфер до создания задачи. TTL 15 мин, purge_expired_bot_attach_pending.';

CREATE INDEX IF NOT EXISTS idx_bot_attach_pending_chat
  ON public.bot_attach_pending (chat_id);

-- Служебная таблица бота: RLS включён, политик нет — доступ только у service role
ALTER TABLE public.bot_attach_pending ENABLE ROW LEVEL SECURITY;

-- TTL-очистка (по образцу purge_expired_bot_task_drafts, миг. 030/036)
CREATE OR REPLACE FUNCTION public.purge_expired_bot_attach_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.bot_attach_pending
  WHERE expires_at < now();
END;
$$;

-- Закрыть SECURITY DEFINER от публичного REST (паттерн 073 GC-функций)
REVOKE EXECUTE ON FUNCTION public.purge_expired_bot_attach_pending() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_expired_bot_attach_pending() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. telegram_message_queue — исходящие файлы агента
--    (send_message_to_chat по очереди MCP-15; base64 — транзитный outbox,
--    GC gc_telegram_message_queue 073 вычищает sent/failed через 7 дней)
-- ---------------------------------------------------------------------------
ALTER TABLE public.telegram_message_queue
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.telegram_message_queue.attachments IS
  'FILE-01/03: исходящие файлы агента [{filename, content_base64, caption?}]. Единственное место, где base64 живёт в БД — транзитный outbox до отправки в Telegram (GC 7 дней, 073).';

COMMENT ON COLUMN public.telegram_message_queue.metadata IS
  'FILE-03: метаданные доставки, напр. {task_id, full_id} для inline-кнопки «Обсудить задачу».';

-- ---------------------------------------------------------------------------
-- 5. Cron: TTL bot_attach_pending (каждые 10 минут, guarded от дублей)
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('bot-attach-ttl')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bot-attach-ttl');

SELECT cron.schedule(
  'bot-attach-ttl',
  '*/10 * * * *',
  $$SELECT public.purge_expired_bot_attach_pending()$$
);