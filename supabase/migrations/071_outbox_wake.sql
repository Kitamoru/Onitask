-- ============================================================================
-- 071_outbox_wake.sql
-- Architecture 0.9 (docs/refactor-ai/12_ADR_REALTIME_WAKE + 13_OUTBOX_PUBLISHER)
-- Realtime wake for the agent CLI runtime.
--
-- Решение (утверждено владельцем):
--   * Wake — только ЕПИФЕМЕРНОЕ уведомление. Work grant остаётся единственным
--     путём POST /api/agent/ops/lease (REST + RPC 062).
--   * Durable intent = dispatch_outbox (уже есть: триггер G1, reaper R7).
--   * Publisher (эта функция) — at-least-once воркер на pg_cron ('10 seconds').
--   * Публичный канал 'agent:<agent_key_id>' (private := false в realtime.send):
--     каждый агент слушает только свой topic, событие получает только владелец
--     канала. В payload НЕТ task_id/секретов — только meta wake'а.
--   * Семантика статусов НЕ трогается: 'published' = «забран ops_lease» (060/062).
--     Храповик однократной отправки broadcast'а — отдельная колонка wake_sent_at.
--   * Сбой realtime.send НЕ деградирует систему: строка остаётся 'pending',
--     задача доставится через ops_lease / reaper requeue в любом случае.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. wake_sent_at — сторож однократной отправки broadcast'а
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispatch_outbox
  ADD COLUMN IF NOT EXISTS wake_sent_at timestamptz;

COMMENT ON COLUMN public.dispatch_outbox.wake_sent_at IS
  '0.9 wake: timestamp of the successful broadcast (at-least-once guard). NULL = not yet sent. Independent of status (pending/published belong to the lease path).';

-- Выборку publisher'а покрывает существующий partial index
-- idx_dispatch_outbox_pending (created_at) WHERE status='pending'
-- (фильтр wake_sent_at IS NULL применяется поверх) — новый индекс не нужен.

-- ---------------------------------------------------------------------------
-- 2. ops_publisher_tick — drain outbox → realtime.send (public channel)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_publisher_tick(p_batch int DEFAULT 100)
RETURNS void
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  rec        RECORD;
  v_payload  jsonb;
  v_channel  text;
BEGIN
  FOR rec IN
    SELECT o.id, o.workspace_id, o.agent_name, o.created_at,
           k.id AS agent_key_id
    FROM public.dispatch_outbox o
    JOIN public.mcp_agent_keys k
      ON k.workspace_id = o.workspace_id
     AND k.agent_name   = o.agent_name
     AND k.revoked_at   IS NULL
    WHERE o.status = 'pending'
      AND o.wake_sent_at IS NULL
    ORDER BY o.created_at
    LIMIT p_batch
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    v_channel := 'agent:' || rec.agent_key_id;
    v_payload := jsonb_build_object(
      'event_id',     rec.id::text,
      'type',         'work.available',
      'workspace_id', rec.workspace_id::text,
      'agent_key_id', rec.agent_key_id::text,
      'ts',           now()::text
    );

    BEGIN
      -- Публичный канал: private := false ЯВНО (дефолт realtime.send — true).
      PERFORM realtime.send(v_payload, 'work.available', v_channel, false);

      UPDATE public.dispatch_outbox
      SET wake_sent_at = now()
      WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      -- Сбой отправки не деградирует доставку: строка остаётся 'pending'
      -- (подхватится следующим tick или ops_lease). Логируем в error.
      UPDATE public.dispatch_outbox
      SET error = left('wake broadcast failed: ' || SQLERRM, 500)
      WHERE id = rec.id;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ops_publisher_tick IS
  '0.9 wake: drains pending outbox rows (SKIP LOCKED, batch) → realtime.send on public channel agent:<agent_key_id>. Sets wake_sent_at on success; never touches status/published_at (lease path). Failure → error column only.';

-- ---------------------------------------------------------------------------
-- 3. Cron — ops-publisher-tick каждые 10 секунд (idempotent register)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-publisher-tick') THEN
    PERFORM cron.schedule(
      'ops-publisher-tick',
      '10 seconds',
      'SELECT public.ops_publisher_tick(100);'
    );
  END IF;
END;
$$;