-- ============================================================
-- onitask · Fix bot_task_drafts TTL partial index
-- File:    037_fix_bot_task_drafts_ttl_index.sql
-- Purpose: Remove invalid TTL partial index from migration 030
--          (now() is not IMMUTABLE — cannot be used in index predicate)
-- Date:    2026-08-19
-- ============================================================

-- Drop the invalid TTL index (safe to run multiple times)
DROP INDEX IF EXISTS public.idx_bot_task_drafts_ttl;

-- The cron job (migration 036) already handles purging every 5 minutes.
-- The purge function uses DELETE WHERE expires_at < now() which works fine
-- without a partial index since it scans by expires_at ASC (idx_bot_task_drafts_user_id covers this).

-- Verify indexes are correct
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'bot_task_drafts' 
ORDER BY indexname;