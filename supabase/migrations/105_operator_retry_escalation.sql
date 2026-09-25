-- ============================================================================
-- 105_operator_retry_escalation.sql
-- AGENT-03: operator-triggered retry for tasks escalated by an AI agent.
--
-- Semantics of "Попробовать снова":
--   * clear the human-escalation gate without deleting task history;
--   * remove only the retry-diagnostic metadata from the active attempt;
--   * enqueue a fresh attempt (attempt=1) for the currently assigned agent;
--   * let existing resolution notification and hosted-runtime push triggers run.
--
-- The task, comments, attachments and relations remain untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.operator_retry_escalation(
  p_workspace_id uuid,
  p_task_id uuid,
  p_actor_worker_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_actor public.workers%ROWTYPE;
  v_agent_name text;
  v_dispatch_created boolean := false;
  v_new_version integer;
BEGIN
  IF p_workspace_id IS NULL OR p_task_id IS NULL OR p_actor_worker_id IS NULL THEN
    RETURN public.ops_error('invalid_request', 'workspace, task and actor worker are required.');
  END IF;

  SELECT *
    INTO v_actor
    FROM public.workers
   WHERE id = p_actor_worker_id
     AND workspace_id = p_workspace_id
     AND is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN public.ops_error('forbidden', 'active workspace worker not found.');
  END IF;

  SELECT *
    INTO v_task
    FROM public.tasks
   WHERE id = p_task_id
     AND workspace_id = p_workspace_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.ops_error('task_not_found', 'task not found in workspace.');
  END IF;

  -- Safe idempotent replay: the first request already cleared the escalation.
  IF v_task.needs_human = false THEN
    RETURN jsonb_build_object(
      'success', true,
      'task_id', v_task.id,
      'needs_human', false,
      'escalation_reason', NULL,
      'is_blocked', v_task.is_blocked,
      'version', v_task.version,
      'updated_at', v_task.updated_at,
      'retry_started', false,
      'dispatch_created', false,
      'already_resolved', true
    );
  END IF;

  IF v_task."column" = 'done' THEN
    RETURN public.ops_error('task_done', 'completed task cannot be retried.');
  END IF;

  IF v_task.is_blocked THEN
    RETURN public.ops_error('task_blocked', 'task blockers must be resolved before retry.');
  END IF;

  IF v_task.active_claim_id IS NOT NULL THEN
    RETURN public.ops_error('task_already_claimed', 'task already has an open execution.');
  END IF;

  SELECT substring(w.source_id FROM 8)
    INTO v_agent_name
    FROM public.workers w
   WHERE w.id = v_task.assigned_to
     AND w.workspace_id = p_workspace_id
     AND w.type = 'agent'
     AND w.is_active = true
     AND w.source_id LIKE 'agent::%'
   LIMIT 1;

  IF v_agent_name IS NULL THEN
    RETURN public.ops_error('agent_not_assigned', 'task is not assigned to an active agent.');
  END IF;

  -- Resolution notification intentionally fires on true -> false.
  UPDATE public.tasks
     SET needs_human = false,
         escalation_reason = NULL,
         metadata = COALESCE(metadata, '{}'::jsonb)
           - 'suggested_action'
           - 'nack_reason'
           - 'nack_detail'
           - 'max_attempts_exceeded',
         updated_at = now()
   WHERE id = p_task_id
   RETURNING version INTO v_new_version;

  INSERT INTO public.task_comments (
    workspace_id, task_id, author_id, author_name, author_type, body, source
  ) VALUES (
    p_workspace_id,
    p_task_id,
    v_actor.id,
    v_actor.display_name,
    'human',
    'Эскалация снята: запущена новая попытка выполнения задачи.',
    'system'
  );

  INSERT INTO public.dispatch_outbox (
    workspace_id, task_id, agent_name, attempt, payload
  ) VALUES (
    p_workspace_id,
    p_task_id,
    v_agent_name,
    1,
    jsonb_build_object(
      'source', 'operator_retry_escalation',
      'actor_worker_id', v_actor.id,
      'previous_escalation_reason', v_task.escalation_reason
    )
  )
  ON CONFLICT (task_id) WHERE status = 'pending' DO NOTHING;

  GET DIAGNOSTICS v_dispatch_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', v_task.id,
    'needs_human', false,
    'escalation_reason', NULL,
    'is_blocked', false,
    'version', v_new_version,
    'updated_at', to_jsonb(now()),
    'retry_started', true,
    'dispatch_created', v_dispatch_created,
    'already_resolved', false
  );
END;
$$;

COMMENT ON FUNCTION public.operator_retry_escalation(uuid, uuid, uuid) IS
  'AGENT-03: atomically clears an AI escalation and queues attempt=1 for the currently assigned active agent; preserves history and fires existing resolution/push triggers.';

REVOKE ALL ON FUNCTION public.operator_retry_escalation(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_retry_escalation(uuid, uuid, uuid)
  TO service_role;
