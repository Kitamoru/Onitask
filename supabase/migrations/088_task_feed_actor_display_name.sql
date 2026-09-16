-- ============================================================================
-- 088_task_feed_actor_display_name.sql
--
-- Фикс: в ленте «Комментарии» (RPC get_task_feed, миграция 076) агентские
-- события, созданные webhook'ом Telegram (tool='bot_command'), показывались
-- с псевдо-именем автора 'telegram_user_<tg_id>'
-- (пример: «telegram_user_425693173 review_requested_fix»).
--
-- Причина: ветка «в» (agent_events) возвращала a.agent_name как author_name
-- как есть, хотя webhook сохраняет реального человека-воркера в
-- metadata.actor_worker_id (uuid workers с display_name).
--
-- Решение: резолвим display_name актора на чтении:
--   LEFT JOIN workers w ON w.id::text = a.metadata->>'actor_worker_id'
--   author_name = COALESCE(w.display_name, a.agent_name)
-- Сравнение текстом (без ::uuid cast) — безопасно для мусорных значений
-- metadata. События реальных агентов (без actor_worker_id) → фолбэк на
-- agent_name, поведение не меняется. Чинит и исторические события
-- (в пределах retention-окна agent_events 7 дней), и все будущие точки записи.
--
-- Псевдо-имя в БД сохраняется (легитимный аудит человеческих действий,
-- решение миграции 052: INV-04 на app-уровне).
-- ============================================================================

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

    -- в) Агентская активность (transient, окно 7 дней по retention).
    --    088: имя автора резолвим из metadata.actor_worker_id (человек,
    --    нажавший «Согласовать»/«Вернуть на доработку» в Telegram),
    --    фолбэк — agent_name (реальные агенты и старые события).
    SELECT
      a.id::text,
      'agent'::text,
      NULL::uuid,
      COALESCE(w.display_name, a.agent_name),
      'agent'::text,
      COALESCE(a.summary, a.tool),
      a.created_at,
      NULL::timestamptz,
      jsonb_build_object('tool', a.tool)
    FROM public.agent_events a
    LEFT JOIN public.workers w
      ON w.id::text = a.metadata->>'actor_worker_id'
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
  'Единый фид вкладки «Комментарии»: task_comments + task_column_history + agent_events (7д). 088: author_name агентских событий резолвится через metadata.actor_worker_id → workers.display_name (фолбэк agent_name). Keyset-пагинация по (created_at, item_id) DESC. AGENT-08.';

REVOKE EXECUTE ON FUNCTION public.get_task_feed(uuid, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_task_feed(uuid, timestamptz, text, integer) TO authenticated, service_role;

-- Security hardening: фиксируем search_path (advisor function_search_path_mutable).
-- Тело функции полностью schema-квалифицировано (public.*, pg_catalog ищется неявно).
ALTER FUNCTION public.get_task_feed(uuid, timestamptz, text, integer) SET search_path = '';
