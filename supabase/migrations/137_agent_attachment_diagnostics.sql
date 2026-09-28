-- ============================================================================
-- 137_agent_attachment_diagnostics.sql
-- Сделать потерю файла видимой: агент сообщает об успехе, которого не было.
--
-- Кейс (ONIT-43, 2026-09-28): Drift вернул storage_path и заявил «Файл успешно
-- загружен в Storage». Объекта в бакете не было. Наш код это поймал — но
-- ровно по двум причинам провал остался невидим:
--
--   1. agent_events_tool_check не содержал 'agent_attachments_dropped'.
--      CHECK отклонял вставку, а logEvent глотал ошибку (голый insert без
--      проверки). Событие о потере файла не появилось в таблице НИ ОДНОГО РАЗА
--      за всё время — не из-за отсутствия потерь, а из-за молчаливого отказа.
--   2. ops_terminal писал в tasks.metadata белый список из четырёх ключей, а
--      attachments/attachments_failed/attachments_rejected уезжали только в
--      task_executions.metadata, куда интерфейс не смотрит. Проверяющий видел
--      карточку «работа выполнена» при нуле вложений. Невидим был и успех:
--      у задачи с УСПЕШНО доставленным файлом в tasks.metadata тоже не было
--      ключа attachments.
--
-- Что меняется:
--   1. agent_events_tool_check дополнен 'agent_attachments_dropped'.
--   2. ops_terminal дублирует в tasks.metadata счётчик вложений и причины
--      отбраковки/провала. Ключи не добавляются, если агент ничего не прислал,
--      поэтому обычные задачи не раздуваются.
--
-- Ключи компактные: attachments_count — целое, attachments_failed и
-- attachments_rejected — массивы {filename, reason}. Полный манифест остаётся
-- в task_executions.metadata и в самой таблице task_attachments, из которой
-- bot-notify и берёт файлы для Telegram.
--
-- КАК ПРИМЕНЕНО (2026-09-28). Файл разбит на две части не по смыслу, а по
-- ограничению инструмента: apply_migration режет длинные statement с телом
-- функции (это же отмечено в 135), поэтому:
--   · часть 1 (CHECK-ограничение) — apply_migration, запись
--     agent_attachments_dropped_event_tool в supabase_migrations;
--   · часть 2 (CREATE OR REPLACE ops_terminal, ~7 КБ) — execute_sql, записи в
--     supabase_migrations НЕТ. Повторное применение файла безопасно: обе части
--     идемпотентны (DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE).
-- Тег $$ в теле функции обязателен: именованный $ops$ через MCP вырезается.
-- Проба с короткой функцией на $p$ проходит — режется длина statement.
-- ============================================================================

BEGIN;

-- 1. Событие о потере файла должно быть записываемым.
ALTER TABLE public.agent_events DROP CONSTRAINT IF EXISTS agent_events_tool_check;

ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_tool_check
  CHECK (tool = ANY (ARRAY[
    'create_task', 'get_tasks_by_column', 'get_workspace_settings', 'get_task_context',
    'move_task', 'escalate_task', 'bot_command', 'send_message_to_chat', 'undo',
    'handoff_task', 'ops_lease', 'ops_heartbeat', 'ops_terminal', 'ops_ack', 'ops_nack',
    'agent_run_submitted', 'agent_run_collected', 'agent_run_failed',
    'agent_attachments_dropped'
  ]::text[]));

COMMENT ON COLUMN public.agent_events.tool IS
  'Имя инструмента/события. agent_attachments_dropped добавлен в 137: без него потеря файла не логировалась.';

-- 2. Диагностика вложений — в tasks.metadata, а не только в execution.
CREATE OR REPLACE FUNCTION public.ops_terminal(
  p_execution_id uuid,
  p_runtime_id   uuid,
  p_task_id      uuid,
  p_task_version int,
  p_outcome      text,
  p_summary      text DEFAULT NULL,
  p_metadata     jsonb DEFAULT '{}'::jsonb,
  p_next_owner   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_exec            record;
  v_agent_worker    uuid;
  v_agent_name      text;
  v_new_version     int;
  v_target_column   text;
  v_details         text;
  v_recommendation  text;
  v_claimed_files   jsonb;
  v_files           jsonb;
BEGIN
  IF p_outcome NOT IN ('review', 'escalate', 'handoff') THEN
    RETURN public.ops_error('invalid_request', 'outcome must be review|escalate|handoff.');
  END IF;

  -- v_files: то, что должен видеть проверяющий в карточке. Собирается из
  -- p_metadata и остаётся пустым объектом, если агент вложения не присылал —
  -- тогда задача не меняется вовсе.
  v_files := '{}'::jsonb;
  IF jsonb_typeof(p_metadata->'attachments') = 'array' THEN
    v_files := v_files || jsonb_build_object(
      'attachments_count', jsonb_array_length(p_metadata->'attachments')
    );
  END IF;
  IF jsonb_typeof(p_metadata->'attachments_failed') = 'array'
     AND jsonb_array_length(p_metadata->'attachments_failed') > 0 THEN
    v_files := v_files || jsonb_build_object(
      'attachments_failed', p_metadata->'attachments_failed'
    );
  END IF;
  IF jsonb_typeof(p_metadata->'attachments_rejected') = 'array'
     AND jsonb_array_length(p_metadata->'attachments_rejected') > 0 THEN
    v_files := v_files || jsonb_build_object(
      'attachments_rejected', p_metadata->'attachments_rejected'
    );
  END IF;

  SELECT e.*, t."column" AS task_column, t.version AS current_version,
         t.active_claim_id AS task_claim, t.assigned_to AS task_assigned
    INTO v_exec
    FROM public.task_executions e
    JOIN public.tasks t ON t.id = e.task_id
   WHERE e.id = p_execution_id
   FOR UPDATE OF e, t;

  IF NOT FOUND THEN
    RETURN public.ops_error('execution_not_found', 'execution not found.');
  END IF;
  IF v_exec.runtime_id IS DISTINCT FROM p_runtime_id THEN
    RETURN public.ops_error('stale_claim', 'runtime_id does not own this execution.');
  END IF;
  IF v_exec.task_id IS DISTINCT FROM p_task_id THEN
    RETURN public.ops_error('stale_claim', 'execution/task mismatch.');
  END IF;

  IF v_exec.status = 'closed' THEN
    IF v_exec.terminal_outcome = p_outcome THEN
      RETURN jsonb_build_object(
        'execution_id', p_execution_id,
        'task_id', p_task_id,
        'task_version', v_exec.current_version,
        'outcome', p_outcome,
        'task_status', v_exec.task_column,
        'execution_status', 'closed'
      );
    END IF;
    RETURN public.ops_error('claim_closed', 'execution already closed with a different terminal outcome.');
  END IF;
  IF v_exec.status = 'expired' THEN
    RETURN public.ops_error('stale_claim', 'execution expired (reaped); lease again.');
  END IF;
  IF v_exec.task_claim IS DISTINCT FROM p_execution_id THEN
    RETURN public.ops_error('stale_claim', 'task claim pointer does not match execution.');
  END IF;
  IF v_exec.current_version IS DISTINCT FROM p_task_version THEN
    RETURN public.ops_error('version_conflict', 'task version changed since lease (CAS).');
  END IF;

  PERFORM set_config('onitask.ops_mutation', '1', true);
  v_details := NULLIF(left(btrim(COALESCE(p_metadata->>'details', '')), 2000), '');
  v_recommendation := NULLIF(left(btrim(COALESCE(p_metadata->>'recommendation', '')), 1000), '');
  v_claimed_files := CASE
    WHEN jsonb_typeof(p_metadata->'claimed_files') = 'array' THEN p_metadata->'claimed_files'
    ELSE '[]'::jsonb
  END;

  IF p_outcome = 'review' THEN
    UPDATE public.tasks
    SET "column" = 'review',
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object(
            'ops_terminal_summary', p_summary,
            'has_result_details', v_details IS NOT NULL,
            'recommendation', v_recommendation,
            'claimed_files', v_claimed_files
          ) || v_files
    WHERE id = p_task_id;
    v_target_column := 'review';

    IF v_details IS NOT NULL THEN
      SELECT w.id, w.display_name
        INTO v_agent_worker, v_agent_name
        FROM public.workers w
       WHERE w.workspace_id = v_exec.workspace_id
         AND w.agent_name = v_exec.agent_name
       LIMIT 1;

      INSERT INTO public.task_comments (workspace_id, task_id, author_id, author_type, body_text, source)
      VALUES (
        v_exec.workspace_id,
        p_task_id,
        v_agent_worker,
        CASE WHEN v_agent_worker IS NULL THEN 'agent'::text ELSE 'worker'::text END,
        v_details,
        'result'
      );
    END IF;

  ELSIF p_outcome = 'escalate' THEN
    UPDATE public.tasks
    SET "column" = v_exec.task_column,
        needs_human = true,
        escalation_reason = COALESCE(p_metadata->>'escalation_reason', p_summary, 'escalate'),
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object(
            'ops_terminal_summary', p_summary,
            'recommendation', v_recommendation,
            'claimed_files', v_claimed_files
          ) || v_files
    WHERE id = p_task_id;
    v_target_column := v_exec.task_column;

  ELSIF p_outcome = 'handoff' THEN
    IF p_next_owner IS NULL OR p_next_owner = '' THEN
      RETURN public.ops_error('invalid_request', 'handoff requires next_owner.');
    END IF;

    IF p_next_owner LIKE 'agent:%' THEN
      v_agent_worker := public.ops_ensure_worker(
        v_exec.workspace_id, substring(p_next_owner from 7)
      );
      IF v_agent_worker IS NULL THEN
        RETURN public.ops_error('agent_not_allowed', 'handoff target agent worker could not be resolved.');
      END IF;
      UPDATE public.tasks
      SET assigned_to = v_agent_worker,
          handoff_to = NULL,
          metadata = COALESCE(metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'handoff_notes', p_metadata->>'handoff_notes',
              'ops_terminal_summary', p_summary,
              'recommendation', v_recommendation,
              'claimed_files', v_claimed_files
            ) || v_files
      WHERE id = p_task_id;
      INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
      VALUES (
        v_exec.workspace_id,
        p_task_id,
        substring(p_next_owner from 7), 1,
        jsonb_build_object('handoff_of', v_exec.id, 'handoff_to', p_next_owner)
      )
      ON CONFLICT (task_id) WHERE status = 'pending' DO NOTHING;
      v_target_column := v_exec.task_column;

    ELSIF p_next_owner = 'human' THEN
      UPDATE public.tasks
      SET assigned_to = NULL,
          needs_human = true,
          escalation_reason = coalesce(p_metadata->>'escalation_reason', p_summary, 'handoff'),
          metadata = COALESCE(metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'ops_terminal_summary', p_summary,
              'recommendation', v_recommendation,
              'claimed_files', v_claimed_files
            ) || v_files
      WHERE id = p_task_id;
      v_target_column := v_exec.task_column;
    ELSE
      RETURN public.ops_error('invalid_request', 'handoff next_owner must be agent:<name> or human.');
    END IF;
  END IF;

  UPDATE public.task_executions
  SET status = 'closed',
      terminal_outcome = p_outcome,
      summary = p_summary,
      metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata,
      closed_at = now()
  WHERE id = p_execution_id;

  UPDATE public.tasks
  SET active_claim_id = NULL
  WHERE id = p_task_id AND active_claim_id = p_execution_id;

  SELECT version INTO v_new_version FROM public.tasks WHERE id = p_task_id;

  INSERT INTO public.agent_events
    (workspace_id, agent_name, tool, task_id, summary, metadata, state_before)
  VALUES
    (v_exec.workspace_id, v_exec.agent_name, 'ops_terminal', p_task_id,
     p_outcome,
     jsonb_build_object(
       'outcome', p_outcome,
       'summary', p_summary,
       'has_details', v_details IS NOT NULL,
       'has_recommendation', v_recommendation IS NOT NULL,
       'claimed_files', v_claimed_files,
       'execution_id', p_execution_id,
       'reason', p_summary
     ),
     jsonb_build_object('task_version_before', v_exec.current_version, 'outcome', p_outcome)
    );

  RETURN jsonb_build_object(
    'execution_id', p_execution_id,
    'task_id', p_task_id,
    'task_version', v_new_version,
    'outcome', p_outcome,
    'task_status', v_target_column,
    'execution_status', 'closed'
  );
END;
$$;

COMMENT ON FUNCTION public.ops_terminal IS
  '104 + 134 + 137: + recommendation, claimed_files, и диагностика вложений (attachments_count/failed/rejected) в tasks.metadata.';

COMMIT;