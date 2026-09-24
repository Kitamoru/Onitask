-- ============================================================================
-- 096_pg_net_health_monitoring.sql
--
-- Observability for pg_net's internal request/response tables.
-- This does not modify net._http_response or pg_net.ttl. It stores only
-- aggregate operational metrics for a rolling 30-day window.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ops_pg_net_health (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at         timestamptz NOT NULL DEFAULT now(),
  heap_bytes         bigint NOT NULL,
  total_bytes        bigint NOT NULL,
  response_rows      bigint NOT NULL,
  queued_requests    integer NOT NULL,
  content_bytes      bigint NOT NULL,
  headers_bytes      bigint NOT NULL,
  failed_responses   integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_pg_net_health_checked_at
  ON public.ops_pg_net_health (checked_at DESC);

ALTER TABLE public.ops_pg_net_health ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ops_pg_net_health FROM PUBLIC;
REVOKE ALL ON TABLE public.ops_pg_net_health FROM anon;
REVOKE ALL ON TABLE public.ops_pg_net_health FROM authenticated;

COMMENT ON TABLE public.ops_pg_net_health IS
  'Rolling 30-day aggregate snapshots of pg_net._http_response health. Service-only; does not contain request payloads or credentials.';

CREATE OR REPLACE FUNCTION public.record_pg_net_health()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, net
AS $$
DECLARE
  v_snapshot_id bigint;
BEGIN
  INSERT INTO public.ops_pg_net_health (
    heap_bytes,
    total_bytes,
    response_rows,
    queued_requests,
    content_bytes,
    headers_bytes,
    failed_responses
  )
  SELECT
    pg_catalog.pg_relation_size('net._http_response'::regclass),
    pg_catalog.pg_total_relation_size('net._http_response'::regclass),
    response_stats.response_rows,
    queue_stats.queued_requests,
    response_stats.content_bytes,
    response_stats.headers_bytes,
    response_stats.failed_responses
  FROM
    (
      SELECT
        count(*)::bigint AS response_rows,
        coalesce(sum(pg_catalog.pg_column_size(content)), 0)::bigint AS content_bytes,
        coalesce(sum(pg_catalog.pg_column_size(headers)), 0)::bigint AS headers_bytes,
        count(*) FILTER (
          WHERE status_code >= 500 OR coalesce(timed_out, false)
        )::integer AS failed_responses
      FROM net._http_response
    ) AS response_stats,
    (
      SELECT count(*)::integer AS queued_requests
      FROM net.http_request_queue
    ) AS queue_stats
  RETURNING id INTO v_snapshot_id;

  -- Keep the monitoring table small. It is a regular, small table; the
  -- retention delete is intentionally local to this service-only table.
  DELETE FROM public.ops_pg_net_health
  WHERE checked_at < now() - interval '30 days';

  RETURN v_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pg_net_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_pg_net_health() FROM anon;
REVOKE ALL ON FUNCTION public.record_pg_net_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_pg_net_health() TO service_role;

COMMENT ON FUNCTION public.record_pg_net_health() IS
  'Writes one aggregate pg_net health snapshot and removes snapshots older than 30 days. Does not mutate pg_net internal tables.';

-- pg_cron may already have the job on environments where this migration is
-- re-applied; unschedule by name first to keep deployment idempotent.
SELECT cron.unschedule('pg-net-health-capture')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pg-net-health-capture'
);

SELECT cron.schedule(
  'pg-net-health-capture',
  '*/15 * * * *',
  $$SELECT public.record_pg_net_health()$$
);
