-- Количество строк
SELECT 'cron.job' AS obj, count(*) AS rows_count FROM cron.job
UNION ALL
SELECT 'cron.job_run_details' AS obj, count(*) AS rows_count FROM cron.job_run_details
UNION ALL
SELECT 'net._http_response' AS obj, count(*) AS rows_count FROM net._http_response;
