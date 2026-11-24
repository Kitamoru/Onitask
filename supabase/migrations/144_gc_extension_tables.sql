-- ============================================================================
-- Migration 144: Системная очистка таблиц расширений pg_cron и pg_net
-- ============================================================================
-- Удаляет старые записи из:
--   cron.job_run_details (старше 7 дней)
--   net._http_response   (старше 24 часов)
--
-- Запускается регулярно через pg_cron джоб 'gc-extension-tables'
-- (ежедневно в 03:00 UTC).
-- ============================================================================

-- Функция очистки системных таблиц расширений
CREATE OR REPLACE FUNCTION public.gc_extension_tables()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cron_deleted bigint;
  v_net_deleted bigint;
BEGIN
  -- cron.job_run_details: храним 7 дней для отладки неудачных запусков джобов
  DELETE FROM cron.job_run_details
  WHERE start_time < now() - interval '7 days';
  GET DIAGNOSTICS v_cron_deleted = ROW_COUNT;

  -- net._http_response: храним 24 часа (pg_net.ttl = 6ч нельзя изменить на Supabase)
  DELETE FROM net._http_response
  WHERE created < now() - interval '24 hours';
  GET DIAGNOSTICS v_net_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'cron_job_run_details_deleted', v_cron_deleted,
    'net_http_response_deleted', v_net_deleted,
    'ran_at', now()
  );
END;
$$;

-- Права: только service_role может выполнять
REVOKE ALL ON FUNCTION public.gc_extension_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gc_extension_tables() FROM anon;
REVOKE ALL ON FUNCTION public.gc_extension_tables() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.gc_extension_tables() TO service_role;

COMMENT ON FUNCTION public.gc_extension_tables() IS
  'Ежедневная очистка таблиц расширений pg_cron.job_run_details и pg_net._http_response. Безопасно: бизнес-логика проекта к этим таблицам не обращается.';


-- Регистрация pg_cron джоба: раз в день в 03:00 UTC
SELECT cron.unschedule('gc-extension-tables')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gc-extension-tables');

SELECT cron.schedule(
  'gc-extension-tables',
  '0 3 * * *',
  $$SELECT public.gc_extension_tables()$$
);
