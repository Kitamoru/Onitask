-- Размер таблиц, мёртвые строки, последняя очистка
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
