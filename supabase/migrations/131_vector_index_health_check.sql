-- ============================================================================
-- 131_vector_index_health_check.sql
-- onitask · Регрессионная проверка здоровья векторных индексов
--
-- Контекст (2026-09-27, плановая фаза после E2E документа):
--
-- 1) На `tasks` стоял IVFFlat `lists=100` при ~50 строках. Кластеров больше,
--    чем векторов, recall схлопнулся почти в ноль, и `match_tasks` физически
--    не мог вернуть строку. На это ушло несколько недель незамеченным.
--
-- 2) Тот же дефект искали в `workspace_doc_chunks` и `agent_memory`, но ИЗМЕРЕНИЕ
--    его не подтвердило: на 14 чанках recall = 42/42 (100%), план запроса —
--    `Index Scan using idx_doc_chunks_embedding`; на 280 синтетических строках
--    в `agent_memory` — 1400 результатов по всем запросам. Оба индекса
--    исправны, оба оставлены как есть (осознанное решение миграции 130, оно же
--    закреплено аксиомой A-4: переход на HNSW при >5000 записей).
--
--    Вывод: чинить здесь нечего. Неполнота охвата — процессная, а не
--    миграционная. Дефект был виден по числу, а не по симптому, и никто на него
--    не смотрел. Закрываем КЛАСС, а не симптом: проверка ниже падает сама.
--
-- Что проверяется:
--   - непустая таблица, где lists > числа строк (меньше одного вектора на
--     кластер) — жёсткая ошибка, именно этот случай был в проде;
--   - пустые таблицы намеренно ИСКЛЮЧЕНЫ. Для них измерять recall нечего и
--     отдавать нечего, а индекс переобучается при наполнении. Без исключения
--     `agent_memory` (50 листов, 0 строк) давал бы ложное срабатывание, и
--     проверку начали бы игнорировать — хуже, чем её отсутствие.
--
-- Чего проверка НЕ делает намеренно: не требует идеала pgvector (>=10 строк на
-- лист). `workspace_doc_chunks` живёт на 1.4 строки на лист при измеренном
-- recall 100%, и требование идеала ругалось бы на исправный индекс.
--
-- Инварианты: индексы, RLS, CHECK-констрейнты и данные не изменяются —
-- миграция только добавляет диагностическую функцию.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Диагностика: по одному векторному индексу — метод, lists, строк, строк/лист.
-- Не падает: пригодна и для ручного вызова, и для дашборда.
-- ---------------------------------------------------------------------------

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
      i.schemaname,
      i.indexdef,
      (xpath(
         '/row/c/text()',
         query_to_xml(
           format('SELECT count(*) AS c FROM %I.%I', i.schemaname, i.tablename),
           false, true, ''
         )
       ))[1]::text::bigint AS row_count
    FROM pg_indexes i
    WHERE i.indexdef ILIKE '%vector%'
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
    round(p.row_count::numeric / greatest(p.lists_param, 1), 2),
    CASE
      WHEN p.method = 'hnsw' THEN 'ok (hnsw, lists не применяется)'
      WHEN p.row_count = 0 THEN 'ok (пустая таблица, исключена из проверки)'
      WHEN p.lists_param > p.row_count THEN
        'ОШИБКА: кластеров больше, чем строк — recall схлопнется'
      ELSE 'ok'
    END
  FROM parsed p
  ORDER BY p.tablename, p.indexname;
$$;

COMMENT ON FUNCTION public.vector_index_health() IS
  'Диагностика векторных индексов (миграция 131, 2026-09-27). Возвращает по '
  'одному индексу метод, lists, число строк и строк на лист. Падает только '
  'на непустой таблице, где lists > строк; пустые исключены намеренно.';

-- ---------------------------------------------------------------------------
-- Жёсткая проверка. Вызывается из миграций и из CI, чтобы регрессия не могла
-- уехать в прод молча.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_vector_index_health()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  bad record;
BEGIN
  SELECT index_name, table_name, lists_param, row_count INTO bad
  FROM public.vector_index_health()
  WHERE verdict LIKE 'ОШИБКА%'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Векторный индекс % на % : lists=% при % строках — кластеров больше, '
      'чем векторов, recall схлопнется (случай tasks lists=100 при 50 строках). '
      'Пересоберите индекс с lists <= строк или перейдите на HNSW.',
      bad.index_name, bad.table_name, bad.lists_param, bad.row_count
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_vector_index_health() IS
  'Бросает исключение, если на непустой таблице векторных индексов кластеров '
  'больше, чем строк (миграция 131). Пустые таблицы исключены намеренно.';

-- Проверяем текущее состояние на момент применения миграции.
DO $$
BEGIN
  PERFORM public.assert_vector_index_health();
  RAISE NOTICE 'vector_index_health: все векторные индексы в допустимом состоянии';
END;
$$;
