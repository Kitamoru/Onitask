-- ============================================================================
-- 104_agent_result_details_and_attachments.sql
-- FILE-01/DS-10: разделить короткий summary, подробный details и файлы агента.
--
-- `summary` остаётся причиной для Telegram-карточки. Новый `details` из
-- p_metadata пишется в task_comments от имени агента, а attachments[] уже
-- сохраняются в Storage до вызова ops_terminal.
-- ============================================================================

ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_source_check;
ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_source_check
  CHECK (source IN ('twa', 'mcp', 'telegram', 'system', 'review', 'cron', 'agent'));

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
  v_exec          record;
  v_agent_worker  uuid;
  v_agent_name    text;
  v_new_version   int;
  v_target_column text;
  v_details       text;
BEGIN
  IF p_outcome NOT IN ('review', 'escalate', 'handoff') THEN
    RETURN public.ops_error('invalid_request', 'outcome must be review|escalate|handoff.');
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

  IF p_outcome = 'review' THEN
    UPDATE public.tasks
    SET "column" = 'review',
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object(
            'ops_terminal_summary', p_summary,
            'has_result_details', v_details IS NOT NULL
          )
    WHERE id = p_task_id;
    v_target_column := 'review';

    IF v_details IS NOT NULL THEN
      SELECT w.id, w.display_name
        INTO v_agent_worker, v_agent_name
        FROM public.workers w
       WHERE w.workspace_id = v_exec.workspace_id
         AND w.type = 'agent'
         AND w.source_id = 'agent::' || v_exec.agent_name
         AND w.is_active = true
       LIMIT 1;

      INSERT INTO public.task_comments
        (workspace_id, task_id, author_id, author_name, author_type,
         body, source, consolidated)
      VALUES
        (v_exec.workspace_id, p_task_id, v_agent_worker,
         COALESCE(v_agent_name, v_exec.agent_name, 'Агент'), 'agent',
         v_details, 'agent', false);
    END IF;

  ELSIF p_outcome = 'escalate' THEN
    UPDATE public.tasks
    SET needs_human = true,
        escalation_reason = coalesce(p_metadata->>'escalation_reason', p_summary, 'не указана'),
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object(
            'suggested_action', p_metadata->>'suggested_action',
            'ops_terminal_summary', p_summary
          )
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
            jsonb_build_object('handoff_notes', p_metadata->>'handoff_notes', 'ops_terminal_summary', p_summary)
      WHERE id = p_task_id;
      INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
      VALUES (
        v_exec.workspace_id, p_task_id,
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
            jsonb_build_object('ops_terminal_summary', p_summary)
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

CREATE OR REPLACE FUNCTION public.notify_task_review()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."column" = 'review' AND OLD."column" IS DISTINCT FROM 'review' THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',   'task_review',
        'task_id',      NEW.id,
        'full_id',      public.task_full_id(NEW.id),
        'title',        COALESCE(
                          NULLIF(NEW.title, ''),
                          NEW.metadata->>'rewritten_title',
                          LEFT(NEW.description, 100)
                        ),
        'created_by',   NEW.created_by,
        'reviewer_id',  NEW.reviewer_id,
        'workspace_id', NEW.workspace_id,
        'reason',       COALESCE(
                          NEW.metadata->>'ops_terminal_summary',
                          (
                            SELECT s.body_text
                            FROM public.task_submissions s
                            WHERE s.task_id = NEW.id
                            ORDER BY s.created_at DESC
                            LIMIT 1
                          )
                        ),
        'has_details',  COALESCE((NEW.metadata->>'has_result_details')::boolean, false)
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.notify_task_done()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."column" = 'done' AND OLD."column" IS DISTINCT FROM 'done' THEN
    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      NEW.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',   'task_done',
        'task_id',      NEW.id,
        'full_id',      public.task_full_id(NEW.id),
        'title',        COALESCE(
                          NULLIF(NEW.title, ''),
                          NEW.metadata->>'rewritten_title',
                          LEFT(NEW.description, 100)
                        ),
        'completed_by', NEW.assigned_to,
        'created_by',   NEW.created_by,
        'via_review',   OLD."column" = 'review',
        'has_details',  COALESCE((NEW.metadata->>'has_result_details')::boolean, false),
        'reason',       COALESCE(
                          NEW.metadata->>'ops_terminal_summary',
                          (
                            SELECT s.body_text
                            FROM public.task_submissions s
                            WHERE s.task_id = NEW.id
                            ORDER BY s.created_at DESC
                            LIMIT 1
                          )
                        )
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

