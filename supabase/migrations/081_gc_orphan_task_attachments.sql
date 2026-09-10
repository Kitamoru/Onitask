-- ============================================================================
-- 081_gc_orphan_task_attachments.sql
-- FILE-07 Phase 2: GC-сирот бинарников Storage 'task-attachments'.
--
-- Проблема: каскад БД (ON DELETE CASCADE) удаляет строки task_attachments
-- ВМЕСТЕ с задачей — вместе с единственным указателем на бинарник в бакете.
-- Обычный путь (DELETE /api/tasks/[id]) чистит Storage явно, но если задача
-- удалена другим способом (каскад от workspace, служебный путь, упавший
-- upload до INSERT манифеста) — бинарники остаются в бакете навсегда.
--
-- Решение: находим объекты в бакете 'task-attachments', для которых НЕТ строки
-- в task_attachments (матчинг name = storage_path), и удаляем их через
-- Storage API (bulk delete). Прямой DELETE из storage.objects заблокирован
-- триггером storage.protect_delete, поэтому — net.http_post + service_role_key
-- из Vault (паттерн 041/get_edge_fn_url). Fire-and-forget c самоисцелением:
-- если HTTP-запрос упал, объект остаётся без манифеста и GC заберёт его
-- следующей ночью. Защита от гонки upload→insert: объекты моложе 1 часа
-- не трогаем. Плюс defensive-очистка манифест-строк, чья задача удалена.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gc_orphan_task_attachments(
  p_batch int DEFAULT 200
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefixes    text[] := '{}';
  v_extra       text[] := '{}';
  v_project_url text;
  v_headers     jsonb;
  v_total       int;
BEGIN
  -- 1. Бинарники-сироты: объект в бакете без строки манифеста.
  --    Объекты моложе 1 часа пропускаем (окно upload → INSERT манифеста).
  SELECT coalesce(array_agg(o.name), '{}') INTO v_prefixes
  FROM (
    SELECT o.name
    FROM storage.objects o
    WHERE o.bucket_id = 'task-attachments'
      AND o.created_at < now() - interval '1 hour'
      AND NOT EXISTS (
        SELECT 1 FROM public.task_attachments a
        WHERE a.storage_path = o.name
      )
    LIMIT LEAST(GREATEST(p_batch, 1), 1000)
  ) o;

  -- 2. Defensive: строки манифеста, чья задача уже не существует
  --    (обычно каскад удаляет их сам; сюда попадают только аномалии).
  --    Пути добавляем к списку удаления, строки удаляем сразу.
  WITH victims AS (
    SELECT a.id, a.storage_path
    FROM public.task_attachments a
    LEFT JOIN public.tasks t ON t.id = a.task_id
    WHERE t.id IS NULL
      AND a.storage_path <> ''
    LIMIT LEAST(GREATEST(p_batch, 1), 1000)
  ), del_rows AS (
    DELETE FROM public.task_attachments a
    USING victims v
    WHERE a.id = v.id
    RETURNING v.storage_path
  )
  SELECT coalesce(array_agg(storage_path), '{}') INTO v_extra FROM del_rows;

  v_prefixes := (
    SELECT coalesce(array_agg(DISTINCT x), '{}')
    FROM unnest(v_prefixes || v_extra) AS x
    WHERE x <> ''
  );

  v_total := coalesce(array_length(v_prefixes, 1), 0);

  -- 3. Bulk delete через Storage API (POST /storage/v1/object/<bucket>).
  IF v_total > 0 THEN
    v_project_url := replace(public.get_edge_fn_url(), '/functions/v1', '');
    v_headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    );
    PERFORM net.http_post(
      url     := v_project_url || '/storage/v1/object/task-attachments',
      headers := v_headers,
      body    := jsonb_build_object('prefixes', to_jsonb(v_prefixes))
    );
  END IF;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.gc_orphan_task_attachments(int) IS
  'FILE-07 Phase 2: находит бинарники-сироты в bucket task-attachments (объект без строки task_attachments, старше 1 часа) и удаляет их через Storage API (net.http_post bulk delete, паттерн 041). Плюс defensive-очистка манифест-строк без задачи. Возвращает число отправленных на удаление путей.';

REVOKE EXECUTE ON FUNCTION public.gc_orphan_task_attachments(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.gc_orphan_task_attachments(int) TO service_role;

-- Cron: ночная очистка (03:10 UTC — в стороне от других gc-джоб 073: 02:xx/04:xx)
SELECT cron.unschedule('gc-orphan-task-attachments')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gc-orphan-task-attachments');

SELECT cron.schedule(
  'gc-orphan-task-attachments',
  '10 3 * * *',
  $$SELECT public.gc_orphan_task_attachments(200)$$
);
