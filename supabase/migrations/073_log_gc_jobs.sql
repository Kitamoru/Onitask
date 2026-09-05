-- ============================================================================
-- 073_log_gc_jobs.sql
-- onitask · Регулярная очистка логоподобных / накопительных таблиц.
--
-- Зачем: аудит retention (2026-09-05): в live-БД были защищены только
-- agent_events (7d), enrichment_queue done (3d), bot_task_drafts (TTL).
-- Ниже — функции GC для таблиц, где очистка отсутствовала:
--   * task_events (retention 30 дней, Master §9) — LTM consolidate не
--     задеплоен, поэтому hard-delete пакетами (FK на tasks CASCADE).
--   * dispatch_outbox (published → 7 дней) — строка «забрана ops_lease».
--   * task_executions (closed/expired → 30 дней) — dispatch_receipts
--     удаляются каскадом (FK ON DELETE CASCADE).
--   * enrichment_queue (failed → 7 дней) — после retry-цикла enrich-task.
--   * bot_review_fix_pending (expires_at TTL 1ч) — «ждём текст причины».
--     Очистка НОЧНАЯ (раз в сутки): consumer (webhook tryConsumeReviewFixReason)
--     сам лениво удаляет истёкшие строки чата, поэтому ежечасный прогон не нужен.
--   * telegram_message_queue (sent/failed → 7 дней).
--   * consolidation_errors (→ 30 дней) — операционный лог LTM.
--
-- Функции повторяемые и пакетные (p_batch), возвращают число удалённых.
-- Секунды в pg_cron НЕ поддерживаются ('*/30 * * * * *' = раз в 30 минут),
-- поэтому расписания только 5-польные. Cron-джобы регистрируются ВРУЧНУЮ
-- (см. 067_ops_reaper): роль миграций не имеет прав на cron.job.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. GC task_events — retention 30 дней (Master §9)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gc_task_events(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.task_events
  WHERE id IN (
    SELECT id
    FROM public.task_events
    WHERE created_at < now() - interval '30 days'
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.gc_task_events IS
  'Retention 30d (Master §9): пакетный hard-delete task_events старше 30 дней. LTM consolidate не задеплоен (003 удалил cron, edge fn нет) — удаление защищает от бесконечного роста.';

REVOKE EXECUTE ON FUNCTION public.gc_task_events(int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. GC ops-истории Arch 0.9 — outbox (published 7d) + executions (closed 30d)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gc_ops_history(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_deleted int := 0;
  v_tmp     int := 0;
BEGIN
  -- dispatch_outbox: 'published' = забрана ops_lease (миграция 062), доставка
  -- больше не требуется; receipts ссылаются на outbox_id ON DELETE SET NULL.
  DELETE FROM public.dispatch_outbox
  WHERE id IN (
    SELECT id
    FROM public.dispatch_outbox
    WHERE status = 'published'
      AND published_at < now() - interval '7 days'
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_deleted := v_deleted + v_tmp;

  -- task_executions: закрытые/истёкшие старше 30 дней. dispatch_receipts
  -- удаляются каскадом (execution_id FK ON DELETE CASCADE).
  DELETE FROM public.task_executions
  WHERE id IN (
    SELECT id
    FROM public.task_executions
    WHERE status IN ('closed', 'expired')
      AND closed_at < now() - interval '30 days'
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_deleted := v_deleted + v_tmp;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.gc_ops_history IS
  'Arch 0.9 history GC: dispatch_outbox published старше 7 дней + task_executions closed/expired старше 30 дней (receipts каскадом).';

REVOKE EXECUTE ON FUNCTION public.gc_ops_history(int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. GC enrichment_queue failed — 7 дней (done-строки чистит существующий
--    cron 'gc-enrichment-queue', jobid 3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gc_enrichment_queue_failed(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.enrichment_queue
  WHERE id IN (
    SELECT id
    FROM public.enrichment_queue
    WHERE status = 'failed'
      AND processed_at < now() - interval '7 days'
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.gc_enrichment_queue_failed IS
  'GC enrichment_queue: удаляет failed-строки старше 7 дней (после retry-цикла enrich-task; done-строки — существующий cron gc-enrichment-queue/jobid 3).';

REVOKE EXECUTE ON FUNCTION public.gc_enrichment_queue_failed(int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. GC bot_review_fix_pending — TTL expires_at (1 час)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gc_bot_review_fix_pending(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.bot_review_fix_pending
  WHERE id IN (
    SELECT id
    FROM public.bot_review_fix_pending
    WHERE expires_at < now()
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.gc_bot_review_fix_pending IS
  'GC bot_review_fix_pending: удаляет протухшие (expires_at) записи «ждём текст причины» — пользователь не ввёл текст за 1 час.';

REVOKE EXECUTE ON FUNCTION public.gc_bot_review_fix_pending(int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. GC telegram_message_queue — sent/failed старше 7 дней
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gc_telegram_message_queue(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.telegram_message_queue
  WHERE id IN (
    SELECT id
    FROM public.telegram_message_queue
    WHERE status IN ('sent', 'failed')
      AND updated_at < now() - interval '7 days'
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.gc_telegram_message_queue IS
  'GC telegram_message_queue: удаляет доставленные (sent) и сдавшиеся (failed) сообщения старше 7 дней.';

REVOKE EXECUTE ON FUNCTION public.gc_telegram_message_queue(int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 6. GC consolidation_errors — операционный лог LTM, 30 дней
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gc_consolidation_errors(p_batch int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.consolidation_errors
  WHERE id IN (
    SELECT id
    FROM public.consolidation_errors
    WHERE created_at < now() - interval '30 days'
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.gc_consolidation_errors IS
  'GC consolidation_errors: операционный лог LTM-консолидации, retention 30 дней.';

REVOKE EXECUTE ON FUNCTION public.gc_consolidation_errors(int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Cron-джобы регистрируются вручную (нет прав у роли миграций на cron.job):
--   SELECT cron.unschedule('gc-task-events') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gc-task-events');
--   SELECT cron.schedule('gc-task-events', '30 3 * * *', $$SELECT public.gc_task_events(5000)$$);
--   SELECT cron.unschedule('gc-ops-history') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gc-ops-history');
--   SELECT cron.schedule('gc-ops-history', '0 4 * * *', $$SELECT public.gc_ops_history(5000)$$);
--   SELECT cron.unschedule('gc-enrichment-failed') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gc-enrichment-failed');
--   SELECT cron.schedule('gc-enrichment-failed', '15 4 * * *', $$SELECT public.gc_enrichment_queue_failed(5000)$$);
--   SELECT cron.unschedule('gc-bot-review-fix-pending') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gc-bot-review-fix-pending');
--   SELECT cron.schedule('gc-bot-review-fix-pending', '30 1 * * *', $$SELECT public.gc_bot_review_fix_pending(5000)$$);
--   SELECT cron.unschedule('gc-telegram-queue') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gc-telegram-queue');
--   SELECT cron.schedule('gc-telegram-queue', '45 4 * * *', $$SELECT public.gc_telegram_message_queue(5000)$$);
--   SELECT cron.unschedule('gc-consolidation-errors') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gc-consolidation-errors');
--   SELECT cron.schedule('gc-consolidation-errors', '0 5 * * *', $$SELECT public.gc_consolidation_errors(5000)$$);
-- ============================================================================