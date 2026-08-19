-- ============================================================
-- onitask · Register bot_task_drafts TTL cron job
-- File:    036_register_bot_task_drafts_ttl_cron.sql
-- Purpose: Register pg_cron schedule for purging expired bot task drafts
-- Date:    2026-08-19
-- ============================================================

-- Enable pg_cron extension (safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Register cron job: run every 5 minutes
-- This calls the function created in migration 030
SELECT cron.schedule(
  'purge-expired-bot-task-drafts',   -- job name
  '*/5 * * * *',                     -- every 5 minutes
  $$ SELECT public.purge_expired_bot_task_drafts() $$
);

-- Verify the cron job was registered
SELECT jobId, schedule, command FROM cron.job WHERE jobname = 'purge-expired-bot-task-drafts';