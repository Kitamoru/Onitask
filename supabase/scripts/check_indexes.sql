-- Размеры индексов
SELECT 
  schemaname,
  indexrelname AS indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE (schemaname = 'net' AND indexrelname LIKE '%http_response%')
   OR (schemaname = 'cron' AND indexrelname LIKE '%job_run_details%')
ORDER BY pg_relation_size(indexrelid) DESC;
