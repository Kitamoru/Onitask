-- ============================================================================
-- 041_register_bot_notify_worker.sql
-- Регистрация pg_cron job для вызова Edge Function bot-notify.
--
-- Обрабатывает enrichment_queue (type='bot_notify'): эскалации, дедлайны,
-- task_assignment (назначение задачи), member_added (добавление участника).
-- ============================================================================

-- Register cron job: run every minute
SELECT cron.schedule(
  'bot-notify-worker',   -- job name
  '* * * * *',           -- every minute
  $$
  SELECT net.http_post(
    url     := 'https://atarmvtzvlwhkheeabeb.supabase.co/functions/v1/bot-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'
  );
  $$
);

-- Verify the cron job was registered
SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'bot-notify-worker';