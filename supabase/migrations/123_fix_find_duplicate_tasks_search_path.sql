-- ============================================================================
-- 123_fix_find_duplicate_tasks_search_path.sql
-- onitask · pg_trgm лежит в схеме extensions, а RPC искал его в public
--
-- Найдено 2026-09-26 при подключении DUP-01: при вызове из функции с
-- `SET search_path = public` RPC падал с
--     ERROR 42883: function similarity(text, text) does not exist
--
-- Причина: `pg_trgm` (1.6) установлен в схему `extensions`
-- (`extensions.similarity(text, text)`), а `find_duplicate_tasks` —
-- LANGUAGE sql БЕЗ собственного `SET search_path`. У SQL-функции тело
-- парсится при вызове в search_path ВЫЗЫВАЮЩЕЙ сессии, поэтому:
--   · из сессии Supabase / psql с путём по умолчанию — работает;
--   · из любой функции с зафиксированным путём (в т.ч. из моей
--     process_duplicate_check) — падает.
--
-- То есть баг был латентным и не проявлялся только потому, что
-- потребителя у `duplicate_check` не существовало (DUP-01). Любой
-- будущий вызов из Edge Function / Route Handler с ограниченным путём
-- упал бы так же.
--
-- Проверено, что пострадала ровно одна функция: из всех объектов public
-- `similarity(` / оператор `<->` встречается только здесь.
--
-- Лечим явной схемой, а не расширением глобального search_path сессии.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_duplicate_tasks(
  p_task_id       uuid,
  p_title         text,
  p_workspace_id  uuid,
  p_threshold     double precision DEFAULT 0.7
)
RETURNS TABLE(id uuid, title text, similarity double precision)
LANGUAGE sql
-- public — тела функций; extensions — pg_trgm (similarity, оператор %).
SET search_path = public, extensions
AS $function$
  SELECT
    t2.id,
    t2.title,
    extensions.similarity(p_title, t2.title) AS similarity
  FROM public.tasks t2
  WHERE t2.workspace_id = p_workspace_id
    AND t2.id          != p_task_id
    AND t2."column"    != 'done'
    AND t2.created_at   > NOW() - INTERVAL '30 days'
    AND p_title OPERATOR(extensions.%) t2.title
    AND extensions.similarity(p_title, t2.title) > p_threshold
  ORDER BY extensions.similarity(p_title, t2.title) DESC
  LIMIT 5;
$function$;

COMMENT ON FUNCTION public.find_duplicate_tasks(uuid, text, uuid, double precision) IS
  'Детект дублей по триграммам (pg_trgm, порог 0.7, окно 30 дней, только не-done). 123: search_path включает extensions, где живёт pg_trgm — без этого вызов из функции с зафиксированным путём падал с 42883.';
