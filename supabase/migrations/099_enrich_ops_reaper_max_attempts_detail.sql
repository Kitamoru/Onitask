-- ============================================================================
-- 099_enrich_ops_reaper_max_attempts_detail.sql
-- Stage 15: reaper (VT expired) тоже пишет корень эскалации.
--
-- Проблема: ops_reaper_tick при исчерпании попыток выставлял только
-- `max_attempts_exceeded`, поэтому карточка эскалации не могла объяснить,
-- почему задача так и не была выполнена (таймаут VT vs отказ агента).
--
-- Что делает: при эскалации пишет `nack_reason = 'vt_expired'` и человеческое
-- `nack_detail` — так bot-notify рендерит ту же секцию «Последняя попытка»/
-- «Детали», что и для отказов через ops_nack.
--
-- Идемпотентно (CREATE OR REPLACE). Применено в БД как migration
-- 20260924185824; файл добавлен для воспроизводимости репозитория.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_reaper_tick(p_batch int DEFAULT 20)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed int := 0;
  v_row record;
BEGIN
  PERFORM set_config('onitask.ops_mutation', '1', true);

  FOR v_row IN
    SELECT id, workspace_id, task_id, agent_name, attempt
    FROM public.task_executions
    WHERE status = 'open'
      AND expires_at < (now() - interval '30 seconds')
    ORDER BY expires_at ASC
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.task_executions
    SET status = 'closed',
        summary = 'vt_expired',
        closed_at = now()
    WHERE id = v_row.id;

    v_closed := v_closed + 1;

    UPDATE public.tasks
    SET active_claim_id = NULL
    WHERE id = v_row.task_id AND active_claim_id = v_row.id;

    IF v_row.attempt < 3 THEN
      INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
      VALUES (
        v_row.workspace_id,
        v_row.task_id,
        v_row.agent_name,
        v_row.attempt + 1,
        jsonb_build_object('reason', 'vt_expired', 'reaper_of', v_row.id)
      )
      ON CONFLICT (task_id) WHERE status = 'pending' DO NOTHING;
    ELSE
      UPDATE public.tasks
      SET needs_human = true,
          escalation_reason = 'max_attempts',
          metadata = COALESCE(metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'max_attempts_exceeded', true,
              'nack_reason', 'vt_expired',
              'nack_detail', 'Таймаут выполнения (VT expired) превысил лимит попыток (3)'
            )
      WHERE id = v_row.task_id;
    END IF;

    INSERT INTO public.agent_events (
      workspace_id, agent_name, tool, task_id, summary, metadata, state_before
    ) VALUES (
      v_row.workspace_id,
      v_row.agent_name,
      'ops_reaper',
      v_row.task_id,
      'vt_expired',
      jsonb_build_object(
        'execution_id', v_row.id,
        'attempt', v_row.attempt,
        'action', CASE WHEN v_row.attempt < 3 THEN 'requeued' ELSE 'escalated' END
      ),
      jsonb_build_object('task_version_before', v_row.attempt)
    );
  END LOOP;

  RETURN v_closed;
END;
$$;
