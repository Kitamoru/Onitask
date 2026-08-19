-- ============================================================
-- onitask · Update bot_task_drafts TTL cron schedule
-- File:    038_update_bot_task_drafts_cron_schedule.sql
-- Purpose: Change purge interval from every 5 minutes to every 60 minutes
-- Date:    2026-08-19
-- ============================================================

-- Drop old cron job if exists (jobId was 11 with schedule */5 * * * *)
DO $$
BEGIN
  -- Unschedule by name (safe to call multiple times)
  PERFORM cron.unschedule('purge-expired-bot-task-drafts');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, ignore
END $$;

-- Create new cron job with updated schedule (every 60 minutes at minute 0)
SELECT cron.schedule(
  'purge-expired-bot-task-drafts',
  '0 * * * *',
  'SELECT public.purge_expired_bot_task_drafts()'
);

-- Verify the change
SELECT jobId, jobname, schedule FROM cron.job WHERE jobname = 'purge-expired-bot-task-drafts';