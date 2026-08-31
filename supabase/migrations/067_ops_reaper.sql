-- ============================================================================
-- 067_ops_reaper.sql
-- Architecture 0.9 Reaper & retry policy (док. 09).
--
-- Компонент: pg_cron-джоб на SQL-функции ops_reaper_tick (НИКАКОЙ edge function:
-- вся логика транзакционна). Секрет/cron-паттерн — как бот-notify (041).
--
-- Действия на каждое открытое execution с истёкшим VT+grace (30s):
--   1. execution → status='expired', closed_at=now();
--   2. tasks.active_claim_id → NULL (version++ делает триггер 046);
--   3. Retry policy: attempt < 3 → dispatch_outbox attempt+1;
--      attempt >= 3 → tasks.needs_human=true + escalation_reason='max_attempts'
--      (триггер эскалации поднимет bot_notify).
-- Идемпотентность: обновляются только status='open'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_reaper_tick(p_batch int DEFAULT 100)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count int := 0;
  v_row record;
BEGIN
  FOR v_row IN
    SELECT e.id AS execution_id, e.task_id, e.workspace_id, e.agent_name, e.attempt
    FROM public.task_executions e
    WHERE e.status = 'open'
      AND e.expires_at < now() - interval '30 seconds'
    ORDER BY e.expires_at
    LIMIT p_batch
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    PERFORM set_config('onitask.ops_mutation', '1', true);

    UPDATE public.task_executions
    SET status = 'closed',
        terminal_outcome = NULL,
        summary = coalesce(summary, '') || ' [vt_expired]',
        closed_at = now(),
        metadata = metadata || jsonb_build_object('close_reason', 'vt_expired')
    WHERE id = v_row.execution_id AND status = 'open';

    UPDATE public.tasks
    SET active_claim_id = NULL
    WHERE id = v_row.task_id AND active_claim_id = v_row.execution_id;

    -- Retry policy (09): attempt+1 до max_attempts; затем escalate
    IF v_row.attempt < 3 THEN
      INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
      VALUES (
        v_row.workspace_id, v_row.task_id, v_row.agent_name, v_row.attempt + 1,
        jsonb_build_object('requeue_of', v_row.execution_id, 'reason', 'vt_expired')
      )
      ON CONFLICT (task_id) WHERE status = 'pending' DO NOTHING;
    ELSE
      UPDATE public.tasks
      SET needs_human = true,
          escalation_reason = 'max_attempts',
          metadata = CASE
            WHEN metadata IS NULL THEN jsonb_build_object('max_attempts_exceeded', true)
            ELSE metadata || jsonb_build_object('max_attempts_exceeded', true)
          END
      WHERE id = v_row.task_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.ops_reaper_tick IS
  'Reaper 0.9 (09): expire открытые VT execution с grace 30s; clear claim; retry attempt+1 < 3 через dispatch_outbox; max_attempts → escalate. Idempotent по status=open.';

-- ---------------------------------------------------------------------------
-- pg_cron: ежеминутно.
-- As-built note: pg_cron в этом проекте НЕ поддерживает поле секунд —
-- расписание '*/30 * * * * *' трактовалось как «раз в 30 минут». Поэтому job
-- зарегистрирован вручную через SELECT cron.schedule(...) с '* * * * *'.
-- Регистрация cron.job не идемпотентна из миграции (permission denied на
-- cron.job для роли миграции), поэтому job создаётся/обновляется вручную:
--   SELECT cron.unschedule('ops-reaper-tick');  -- если существует
--   SELECT cron.schedule('ops-reaper-tick', '* * * * *',
--                        $cron$SELECT public.ops_reaper_tick(100)$cron$);
-- Применено 2026-08-31 (jobid 19).
-- ---------------------------------------------------------------------------