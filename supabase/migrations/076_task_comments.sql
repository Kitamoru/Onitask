-- ============================================================================
-- 076_task_comments.sql
-- onitask · AGENT-08: вкладка «Комментарии» (Figma 322-27840)
--
-- ADR: комментарии — отдельная durable-таблица task_comments, а НЕ task_events.
-- Причины (ADR-2026-09-06, docs/decisions.md):
--   1. gc_task_events (073) удаляет task_events старше 30 дней БЕЗ фильтра по
--      event_type → пользовательский контент сгорал бы на 31-й день.
--   2. task_events не имеет FK на workers(id) — автор жил бы только в jsonb
--      payload (нарушение Worker Model; INSERT-политика 002 позволяла любому
--      члену воркспейса подставить произвольный payload.author_id — спуфинг).
--   3. task_events — immutable-лог для Memory Consolidation; комментариям
--      нужны edit/delete/replies (Phase 2) → другое время жизни и семантика.
-- task_events остаётся как есть (parse_rewrite от ai/create-task, GC 30д).
--
-- Retention: БЕЗЛИМИТНЫЙ (решение R2) — gc-джобы не трогают эту таблицу.
--
-- Запись: только через Route Handlers (service role, автор резолвится
-- server-side из Telegram initData). Прямых INSERT/UPDATE/DELETE политик для
-- клиентов НЕТ — только SELECT для членов воркспейса (паттерн 002).
--
-- Realtime: клиент TWA не имеет Supabase-JWT → postgres_changes не доставит
-- строки клиенту; live-обновления через server-side broadcast на канал
-- 'task-comments-<task_id>' (см. src/app/api/tasks/[id]/comments/route.ts).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Таблица
-- ---------------------------------------------------------------------------
CREATE TABLE public.task_comments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id       uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Автор — ВСЕГДА server-side из auth (getActiveWorkerInWorkspace), не из тела запроса.
  author_id     uuid        REFERENCES public.workers(id) ON DELETE SET NULL, -- NULL = воркер удалён
  author_name   text        NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 100), -- снимок при INSERT
  author_type   text        NOT NULL CHECK (author_type IN ('human', 'agent')),
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  source        text        NOT NULL DEFAULT 'twa' CHECK (source IN ('twa', 'mcp', 'telegram', 'system')),
  parent_id     uuid        REFERENCES public.task_comments(id) ON DELETE CASCADE, -- ответы (Phase 2)
  ref_task_id   uuid        REFERENCES public.tasks(id) ON DELETE SET NULL,        -- вложение задачи (Phase 2)
  edited_at     timestamptz,
  deleted_at    timestamptz,   -- мягкое удаление (Phase 2), фид фильтрует
  consolidated  boolean     NOT NULL DEFAULT false, -- для будущей консолидации в агент-контекст
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_comments IS
  'Durable-комментарии к задачам (люди + агенты). Retention безлимитный, GC не трогает. ADR-2026-09-06: вынесены из task_events (тот горит за 30 дней по 073 и не имеет FK на workers).';

-- Keyset-пагинация фида по задаче (основной read-path)
CREATE INDEX idx_task_comments_task_created
  ON public.task_comments (task_id, created_at)
  WHERE deleted_at IS NULL;
-- Фид по воркспейсу (Stream/поиск, будущие фичи)
CREATE INDEX idx_task_comments_workspace
  ON public.task_comments (workspace_id)
  WHERE deleted_at IS NULL;
-- Memory Consolidation: выборка неконсолидированных (ai_.md §5)
CREATE INDEX idx_task_comments_consolidated
  ON public.task_comments (consolidated, created_at)
  WHERE consolidated = false;

-- ---------------------------------------------------------------------------
-- 2. RLS: SELECT только членам воркспейса; запись — только service role
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_comments_select_member
  ON public.task_comments
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- 3. Security-fix: закрываем дыру прямой вставки комментариев в task_events.
--    Политика 002 позволяла ЛЮБОМУ члену воркспейса INSERT event_type='comment'
--    с произвольным payload (в т.ч. чужой author_id) мимо сервера.
--    Комментарии теперь живут в task_comments; 'comment' в task_events
--    больше никем не пишется (проверено grep по кодовой базе).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS task_events_insert_comment ON public.task_events;

-- ---------------------------------------------------------------------------
-- 4. RPC get_task_feed — единый фид вкладки «Комментарии» (решение R5):
--    а) task_comments (durable, люди + агенты)
--    б) task_column_history (durable, хроника статусов; task_events для этого
--       не используется — status_change/assignment в коде никем не пишутся)
--    в) agent_events.summary (transient, окно 7 дней по retention 001 §4.5)
--    Keyset-пагинация назад по времени: (created_at, item_id) DESC.
--    Вызывается Route Handler-ом через service role (RLS bypass) и переис-
--    пользуется будущим MCP-инструментом. SECURITY INVOKER — права определяет
--    вызывающий (service role / authenticated с RLS своих воркспейсов).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_task_feed(
  p_task_id        uuid,
  p_cursor_created timestamptz DEFAULT NULL,
  p_cursor_id      text        DEFAULT NULL,
  p_limit          integer     DEFAULT 30
)
RETURNS TABLE (
  item_id     text,
  kind        text,      -- 'comment' | 'status' | 'agent'
  author_id   uuid,
  author_name text,
  author_type text,      -- 'human' | 'agent' | 'system'
  body        text,
  created_at  timestamptz,
  edited_at   timestamptz,
  payload     jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    -- а) Комментарии (durable) — алиасы задают имена колонок UNION
    SELECT
      c.id::text           AS item_id,
      'comment'::text      AS kind,
      c.author_id          AS author_id,
      c.author_name        AS author_name,
      c.author_type        AS author_type,
      c.body               AS body,
      c.created_at         AS created_at,
      c.edited_at          AS edited_at,
      jsonb_build_object(
        'source', c.source,
        'ref_task_id', c.ref_task_id,
        'parent_id', c.parent_id
      )                    AS payload
    FROM public.task_comments c
    WHERE c.task_id = p_task_id
      AND c.deleted_at IS NULL

    UNION ALL

    -- б) Хроника статусов (durable; task_column_history, НЕ task_events)
    SELECT
      h.id::text,
      'status'::text,
      h.moved_by,
      COALESCE(w.display_name, 'Система'),
      COALESCE(w.type, 'system'),
      NULL::text,
      h.moved_at,
      NULL::timestamptz,
      jsonb_build_object('from_column', h.from_column, 'to_column', h.to_column)
    FROM public.task_column_history h
    LEFT JOIN public.workers w ON w.id = h.moved_by
    WHERE h.task_id = p_task_id

    UNION ALL

    -- в) Агентская активность (transient, окно 7 дней по retention)
    SELECT
      a.id::text,
      'agent'::text,
      NULL::uuid,
      a.agent_name,
      'agent'::text,
      COALESCE(a.summary, a.tool),
      a.created_at,
      NULL::timestamptz,
      jsonb_build_object('tool', a.tool)
    FROM public.agent_events a
    WHERE a.task_id = p_task_id
      AND a.is_undone = false
      AND a.created_at > now() - interval '7 days'
  ) feed
  WHERE
    (
      p_cursor_created IS NULL
      OR feed.created_at < p_cursor_created
      OR (feed.created_at = p_cursor_created AND feed.item_id < p_cursor_id)
    )
  ORDER BY feed.created_at DESC, feed.item_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

COMMENT ON FUNCTION public.get_task_feed(uuid, timestamptz, text, integer) IS
  'Единый фид вкладки «Комментарии»: task_comments + task_column_history + agent_events (7д). Keyset-пагинация по (created_at, item_id) DESC. AGENT-08.';

REVOKE EXECUTE ON FUNCTION public.get_task_feed(uuid, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_task_feed(uuid, timestamptz, text, integer) TO authenticated, service_role;
