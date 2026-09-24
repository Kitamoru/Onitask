-- ============================================================================
-- 098_enrich_max_attempts_escalation_detail.sql
-- Stage 15 · диагностика провала агента: корень попытки больше не теряется.
--
-- Проблема (найдена по боевому прогону Drift): задача уходила в эскалацию
-- `max_attempts`, но в metadata оставался только `nack_reason: transient_error`
-- без деталей — «Агент вернул не JSON-контракт» без указания, ЧТО он вернул.
-- Причина двойная:
--   1. ops_nack принимал p_detail, но не сохранял его в task_executions и
--      не переносил в tasks.metadata;
--   2. trigger_escalation_alert не прокидывал nack_reason/nack_detail в payload
--      bot_notify — карточка эскалации была безликой.
--
-- Что делает:
--   1. ops_nack пишет p_detail в task_executions.metadata (nack_detail) и — при
--      эскалации (unsupported_task / исчерпание попыток) — в tasks.metadata
--      рядом с nack_reason.
--   2. trigger_escalation_alert добавляет nack_reason/nack_detail в payload
--      enrichment_queue (bot-notify рисует «Последняя попытка»/«Детали»).
--
-- Идемпотентно (CREATE OR REPLACE). Применено в БД как migration
-- 20260924185738; файл добавлен для воспроизводимости репозитория.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_nack(
  p_execution_id uuid,
  p_runtime_id   uuid,
  p_receipt      text,
  p_reason       text,
  p_detail       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exec record;
BEGIN
  IF p_reason NOT IN ('unsupported_task', 'runtime_busy', 'dependency_unavailable', 'transient_error', 'other') THEN
    RETURN public.ops_error('invalid_request', 'unrecognized nack reason.');
  END IF;

  SELECT e.* INTO v_exec FROM public.task_executions e WHERE e.id = p_execution_id;

  IF NOT FOUND THEN
    RETURN public.ops_error('execution_not_found', 'execution not found.');
  END IF;

  IF v_exec.runtime_id IS DISTINCT FROM p_runtime_id THEN
    RETURN public.ops_error('stale_claim', 'runtime_id does not own this execution.');
  END IF;

  IF v_exec.status <> 'open' THEN
    RETURN public.ops_error('claim_closed', 'execution is not open; nothing to nack.');
  END IF;

  PERFORM set_config('onitask.ops_mutation', '1', true);

  UPDATE public.task_executions
  SET status = 'closed',
      summary = p_reason,
      metadata = COALESCE(metadata, '{}'::jsonb) ||
        jsonb_build_object('nack_reason', p_reason, 'nack_detail', p_detail),
      closed_at = now()
  WHERE id = p_execution_id;

  UPDATE public.tasks
  SET active_claim_id = NULL
  WHERE id = v_exec.task_id AND active_claim_id = p_execution_id;

  IF p_reason = 'unsupported_task' THEN
    UPDATE public.tasks
    SET needs_human = true,
        escalation_reason = 'unsupported_task',
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object('nack_reason', p_reason, 'nack_detail', p_detail)
    WHERE id = v_exec.task_id;
  ELSE
    IF v_exec.attempt < 3 THEN
      INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
      VALUES (
        v_exec.workspace_id, v_exec.task_id, v_exec.agent_name, v_exec.attempt + 1,
        jsonb_build_object('nack_reason', p_reason, 'nack_detail', p_detail, 'nack_of', p_execution_id)
      )
      ON CONFLICT (task_id) WHERE status = 'pending' DO NOTHING;
    ELSE
      UPDATE public.tasks
      SET needs_human = true,
          escalation_reason = 'max_attempts',
          metadata = COALESCE(metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'nack_reason', p_reason,
              'nack_detail', p_detail,
              'max_attempts_exceeded', true
            )
      WHERE id = v_exec.task_id;
    END IF;
  END IF;

  INSERT INTO public.agent_events (workspace_id, agent_name, tool, task_id, summary, metadata, state_before)
  VALUES (
    v_exec.workspace_id, v_exec.agent_name, 'ops_nack', v_exec.task_id,
    p_reason,
    jsonb_build_object('nack_reason', p_reason, 'nack_detail', p_detail, 'execution_id', p_execution_id),
    jsonb_build_object('task_version_before', v_exec.attempt)
  );

  RETURN jsonb_build_object(
    'execution_id', p_execution_id,
    'receipt', p_receipt,
    'nacked', true,
    'requeued', p_reason <> 'unsupported_task'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_escalation_alert()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.needs_human = true
     AND (OLD.needs_human IS DISTINCT FROM NEW.needs_human) THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload, status, scheduled_at)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',        'escalation_alert',
        'task_id',           NEW.id,
        'full_id',           public.task_full_id(NEW.id),
        'title',             NEW.title,
        'escalation_reason', COALESCE(NEW.escalation_reason, 'не указана'),
        'suggested_action',  NEW.metadata->>'suggested_action',
        'nack_reason',       NEW.metadata->>'nack_reason',
        'nack_detail',       NEW.metadata->>'nack_detail',
        'workspace_id',      NEW.workspace_id
      ),
      'pending',
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
