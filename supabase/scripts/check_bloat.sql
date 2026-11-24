-- Проверка размера и блоатировки таблиц
SELECT 
  schemaname,
  relname AS tablename,
  pg_size_pretty(pg_relation_size(relid)) AS heap_size,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  n_live_tup AS live_rows,
  n_dead_tup AS dead_rows,
  last_vacuum,
  last_autovacuum,
  vacuum_count,
  autovacuum_count
FROM pg_stat_user_tables
WHERE (schemaname = 'net' AND relname = '_http_response')
   OR (schemaname = 'cron' AND relname = 'job_run_details')
ORDER BY schemaname, relname;

-- Размеры индексов
SELECT 
  schemaname,
  indexrelname AS indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE (schemaname = 'net' AND indexrelname LIKE '%http_response%')
   OR (schemaname = 'cron' AND indexrelname LIKE '%job_run_details%')
ORDER BY pg_relation_size(indexrelid) DESC;

-- Количество строк
SELECT 'cron.job' AS obj, count(*) AS rows_count FROM cron.job
UNION ALL
SELECT 'cron.job_run_details' AS obj, count(*) AS rows_count FROM cron.job_run_details
UNION ALL
SELECT 'net._http_response' AS obj, count(*) AS rows_count FROM net._http_response;

-- Коэффициент блоатировки
SELECT 
  schemaname,
  relname AS tablename,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_only_size,
  round(
    CASE 
      WHEN pg_relation_size(relid) = 0 THEN 0
      ELSE (pg_total_relation_size(relid)::float / pg_relation_size(relid)::float - 1) * 100
    END::numeric, 2
  ) AS bloat_percent
FROM pg_stat_user_tables
WHERE (schemaname = 'net' AND relname = '_http_response')
   OR (schemaname = 'cron' AND relname = 'job_run_details');
