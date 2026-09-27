-- ============================================================================
-- 130_repair_vector_search.sql
-- onitask · Починка векторного поиска: индекс tasks + два драйвера очередей
--
-- Контекст (2026-09-27, аудит перед B+A):
--
-- 1) ИНДЕКС. `idx_tasks_embedding` был IVFFlat `lists=100` при ~50 строках.
--    Для pgvector lists должно быть кратно меньше числа строк: при lists=100 и
--    50 векторах на кластер приходится ~0.5 строки, и recall деградирует.
--    Переходим на HNSW: он не требует переобучения при росте таблицы, то есть
--    отпадает целый класс проблем с подбором lists при backfill.
--
--    Это ОТКЛОНЕНИЕ от аксиомы A-4 («IVFFlat, переход на HNSW при >5000
--    записей»). A-4 писалась под другую таблицу; здесь вырожденность
--    наступила намного раньше. Зафиксировано в docs/memory-bank/decisions.md.
--    pgvector 0.8.0 (проверено: extversion = '0.8.0') HNSW поддерживает.
--
-- 2) ДРАЙВЕР `task-embed`. Триггер trg_invalidate_task_embedding обнуляет
--    tasks.embedding при ЛЮБОМ изменении title/description, а пересчёт жил
--    только внутри F-03, который запускается один раз при создании задачи.
--    В итоге эмбеддингов было 2 на 50 задач, и match_tasks (исключает саму
--    задачу) физически не мог вернуть строку.
--
-- 3) ДРАЙВЕР `doc-process`. Единственный триггер был fire-and-forget fetch
--    из Route Handler (documents/route.ts): если процесс умирал сразу после
--    загрузки, джоб навсегда оставался 'pending' — некому было его разобрать
--    (enrich-task берёт только type='card'; cron-задание 5 закрывает только
--    'processing' старше 2 часов). Теперь очередь doc_process разбирается
--    кроном.
--
-- Инварианты: INV-05 не затронут (функции пишут по workspace_id задачи),
-- RLS не меняется, CHECK-констрейнты не меняются.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Индекс tasks.embedding: IVFFlat lists=100 → HNSW
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_tasks_embedding;

CREATE INDEX IF NOT EXISTS idx_tasks_embedding
  ON public.tasks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX public.idx_tasks_embedding IS
  'HNSW cosine (pgvector 0.8.0). Заменил IVFFlat lists=100, который при ~50 '
  'строках давал ~0.5 вектора на кластер. HNSW не требует переобучения при '
  'росте таблицы. Миграция 130, 2026-09-27.';

-- ---------------------------------------------------------------------------
-- 2. Крон: task-embed (пересчёт эмбеддингов задач)
--    Раз в 5 минут: операция батчевая и упирается в общий лимит NeuralDeep
--    60 RPM вместе с холодным контуром. Чаще — бессмысленно, реже — дольше
--    живут задачи без вектора.
-- ---------------------------------------------------------------------------

SELECT cron.unschedule('task-embed-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-embed-sweep');

SELECT cron.schedule(
  'task-embed-sweep',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := public.get_edge_fn_url() || '/task-embed',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- 3. Крон: doc-process (чанкинг документов)
--    Раз в 2 минуты, а не раз в минуту: функция сама занимает до 120 секунд
--    (soft timeout) и делает батчи эмбеддингов, поэтому ежеминутный запуск
--    гарантированно перекрывался бы. Двойная обработка одного джоба при этом
--    исключена атомарным захватом: UPDATE ... WHERE status='pending'.
-- ---------------------------------------------------------------------------

SELECT cron.unschedule('doc-process-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'doc-process-tick');

SELECT cron.schedule(
  'doc-process-tick',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := public.get_edge_fn_url() || '/doc-process',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- 4. Заметка об индексе чанков: idx_doc_chunks_embedding остаётся IVFFlat
--    lists=10. При 0 строк и лимите 20 файлов × 55 чанков это адекватно;
--    пересматривать при >5000 чанков, как и записано в A-4.
-- ---------------------------------------------------------------------------

COMMENT ON INDEX public.idx_doc_chunks_embedding IS
  'IVFFlat lists=10. Оставлен как есть (миграция 130): при текущем объёме KB '
  'вырожденности lists нет. Возможен переход на HNSW при >5000 чанков.';
