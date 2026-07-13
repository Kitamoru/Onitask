-- ============================================================
-- onitask · P0 Fixes Migration
-- File:    003_p0_fixes.sql
-- Version: 1.0.0
-- Date:    2026-07-12
-- Master:  onitask_Architecture_Master_.md v0.13.2
--
-- Исправления критических проблем Supabase:
--   1. Удаление 4 сломанных cron job'ов (net.http_post без edge_fn_url)
--   2. REVOKE EXECUTE FROM PUBLIC на SECURITY DEFINER функциях
--   3. GRANT EXECUTE TO authenticated
--   4. Комментарий про настройку app.edge_fn_url
--
-- Запускать ПОСЛЕ 002_rls.sql
-- ============================================================

-- ============================================================
-- SECTION 1: Удаление сломанных cron job'ов
-- ============================================================
-- Эти job'и используют net.http_post() который требует
-- установленную переменную app.edge_fn_url. Она никогда не была
-- установлена, поэтому эти job'и падают с ошибкой "function net.http_post() does not exist".
-- Edge Functions будут вызываться из Route Handlers / UI по требованию.

-- Job 'memory-consolidation' (каждые 15 мин) → /consolidate
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-consolidation') THEN
    PERFORM cron.unschedule('memory-consolidation');
    RAISE NOTICE 'Deleted cron job: memory-consolidation';
  ELSE
    RAISE NOTICE 'Cron job not found: memory-consolidation (already deleted or never created)';
  END IF;
END $$;

-- Job 'monitor-enrichment-queue' (каждые 10 мин) → /queue-monitor
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-enrichment-queue') THEN
    PERFORM cron.unschedule('monitor-enrichment-queue');
    RAISE NOTICE 'Deleted cron job: monitor-enrichment-queue';
  ELSE
    RAISE NOTICE 'Cron job not found: monitor-enrichment-queue (already deleted or never created)';
  END IF;
END $$;

-- Job 'standup-dispatcher' (каждую минуту) → /standup-dispatcher
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'standup-dispatcher') THEN
    PERFORM cron.unschedule('standup-dispatcher');
    RAISE NOTICE 'Deleted cron job: standup-dispatcher';
  ELSE
    RAISE NOTICE 'Cron job not found: standup-dispatcher (already deleted or never created)';
  END IF;
END $$;

-- Job 'check-anomalies-daily' (в 6 утра) → /check-anomalies-daily
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-anomalies-daily') THEN
    PERFORM cron.unschedule('check-anomalies-daily');
    RAISE NOTICE 'Deleted cron job: check-anomalies-daily';
  ELSE
    RAISE NOTICE 'Cron job not found: check-anomalies-daily (already deleted or never created)';
  END IF;
END $$;

-- ============================================================
-- SECTION 2: Безопасность SECURITY DEFINER функций
-- ============================================================
-- REVOKE EXECUTE FROM PUBLIC — все функции теперь доступны
-- только аутентифицированным пользователям через service role.

-- get_my_workspace_ids(): возвращает workspace_id текущего JWT-пользователя
REVOKE EXECUTE ON FUNCTION public.get_my_workspace_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_ids() TO authenticated;

-- is_workspace_admin(): проверяет роль owner/admin в workspace
REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated;

-- ============================================================
-- SECTION 3: Информационный комментарий
-- ============================================================
-- Для разработчиков: если нужно активировать cron jobs, которые
-- вызывают Edge Functions, выполните следующие шаги:

COMMENT ON SCHEMA public IS 'onitask schema — RLS enabled.

CRON JOBS SETUP (если нужны автоматические вызовы Edge Functions):
  1. Получить project URL: supabase project settings → API → Project URL
  2. Получить service role key: supabase project settings → API → SERVICE_ROLE_KEY
  3. Выполнить:
     ALTER DATABASE postgres SET app.edge_fn_url = ''https://xyz.supabase.co/functions/v1'';
     ALTER DATABASE postgres SET app.service_key = ''sb_svc_<key>'';
  4. Пересоздать cron jobs из 001_init.sql (Section 8)

БЕЗОПАСНОСТЬ:
  - Все SECURITY DEFINER функции имеют REVOKE EXECUTE FROM PUBLIC
  - EXECUTE предоставлен только роли authenticated
  - RLS включён на всех таблицах (см. 002_rls.sql)
  - Таблицы enrichment_queue, agent_memory и др. — только service role
';

-- ============================================================
-- END OF 003_p0_fixes.sql
-- ============================================================