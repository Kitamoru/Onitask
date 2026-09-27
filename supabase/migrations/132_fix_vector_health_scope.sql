-- ============================================================================
-- 132_fix_vector_health_scope.sql
-- onitask · Исправление области действия vector_index_health (миграция 131)
--
-- 131 использует фильтр `indexdef ILIKE '%vector%'`, и он захватывает
-- СЛУЖЕБНЫЕ КАТАЛОГИ САМОГО pgvector — `vector_indexes` и `buckets_vectors`.
-- Это внутренние таблицы расширения, а не данные приложения: они попадали в
-- отчёт как векторные индексы проекта. Формально ошибки не давали (у них
-- lists_param = NULL, и сравнение с NULL даёт NULL, а не true), но отчёт
-- врал о составе базы, а это хуже лишней строки — на такой вывод нельзя
-- опереться при разборе.
--
-- Также добавлена защита для IVFFlat-индекса, у которого параметр lists не
-- удалось разобрать: раньше такой индекс молча проходил как «ok».
-- Теперь он помечается как требующий проверки — молчание опаснее флага.
--
-- Данные, индексы, RLS и CHECK-констрейнты не изменяются.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.vector_index_health()
RETURNS TABLE (
  index_name       text,
  table_name       text,
  index_method     text,
  lists_param      integer,
  row_count        bigint,
  rows_per_list    numeric,
  verdict          text
)
LANGUAGE sql
STABLE
AS $$
  WITH vi AS (
    SELECT
      i.indexname,
      i.tablename,
      i.indexdef,
      (xpath(
         '/row/c/text()',
         query_to_xml(
           format('SELECT count(*) AS c FROM %I.%I', i.schemaname, i.tablename),
           false, true, ''
         )
       ))[1]::text::bigint AS row_count
    FROM pg_indexes i
    -- Только public: иначе в отчёт попадают внутренние каталоги pgvector
    -- (vector_indexes, buckets_vectors) — служебные объекты расширения.
    WHERE i.schemaname = 'public'
      AND i.indexdef ILIKE '%vector%'
  ),
  parsed AS (
    SELECT
      indexname,
      tablename,
      CASE WHEN indexdef ILIKE '%hnsw%' THEN 'hnsw' ELSE 'ivfflat' END AS method,
      NULLIF(substring(indexdef FROM 'lists=''([0-9]+)'''), '')::integer AS lists_param,
      row_count
    FROM vi
  )
  SELECT
    p.indexname,
    p.tablename,
    p.method,
    p.lists_param,
    p.row_count,
    CASE
      WHEN p.lists_param IS NULL THEN NULL
      ELSE round(p.row_count::numeric / p.lists_param, 2)
    END,
    CASE
      WHEN p.method = 'hnsw' THEN 'ok (hnsw, lists не применяется)'
      WHEN p.lists_param IS NULL THEN
        'ТРЕБУЕТ ПРОВЕРКИ: IVFFlat без разбираемого параметра lists'
      WHEN p.row_count = 0 THEN 'ok (пустая таблица, исключена из проверки)'
      WHEN p.lists_param > p.row_count THEN
        'ОШИБКА: кластеров больше, чем строк — recall схлопнется'
      ELSE 'ok'
    END
  FROM parsed p
  ORDER BY p.tablename, p.indexname;
$$;

COMMENT ON FUNCTION public.vector_index_health() IS
  'Диагностика векторных индексов (миграции 131/132, 2026-09-27). Только схема '
  'public — служебные каталоги pgvector исключены. Падает только на непустой '
  'таблице, где lists > строк; пустые исключены намеренно.';

-- Проверяем исправленную версию.
DO $$
BEGIN
  PERFORM public.assert_vector_index_health();
  RAISE NOTICE 'vector_index_health: область действия исправлена, состояние допустимо';
END;
$$;
