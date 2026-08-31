-- ============================================================================
-- 062_ops_rpc.sql
-- Architecture 0.9 Ops API — transaction layer (док. 01).
--
-- G3: «pick outbox → insert execution → update task → receipt» НЕЛЬЗЯ делать
-- атомарно через supabase-js. Вся TX-логика живёт здесь, в Postgres-RPC;
-- Next.js-роуты — тонкие (auth → RPC → маппинг ошибок).
--
-- Инварианты (док. 01):
--   * REST = canonical; execution_id = домен; receipt = доставка.
--   * lease: 1 TX создаёт execution → задача in_progress + active_claim_id.
--   * terminal: только здесь агент завершает (review|escalate|handoff).
--   * Idempotent: same outcome повторно → 200; другой outcome → 409 claim_closed.
--   * Stale/Foreign → 409; пустой lease → {job:null}.
--   * version инкрементится ТОЛЬКО триггером 046 (bump_task_version) — функции
--     никогда не пишут version явно (G5).
--   * Оps-мутации идут с set_config('onitask.ops_mutation','1',true), чтобы
--     триггер human_override (миграция 063) не воспринял их как человеческие.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_ensure_worker(
  p_workspace_id uuid,
  p_agent_name   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_worker_id uuid;
  v_source_id text := 'agent::' || p_agent_name;
BEGIN
  SELECT id INTO v_worker_id
  FROM public.workers
  WHERE workspace_id = p_workspace_id AND source_id = v_source_id AND is_active = true
  LIMIT 1;
  IF v_worker_id IS NOT NULL THEN
    RETURN v_worker_id;
  END IF;

  INSERT INTO public.workers (workspace_id, type, display_name, source_id)
  VALUES (p_workspace_id, 'agent', p_agent_name, v_source_id)
  ON CONFLICT (workspace_id, source_id) DO NOTHING;

  SELECT id INTO v_worker_id
  FROM public.workers
  WHERE workspace_id = p_workspace_id AND source_id = v_source_id AND is_active = true
  LIMIT 1;
  RETURN v_worker_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_error(
  p_code text,
  p_message text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
-- ---------------------------------------------------------------------------
-- 1. ops_lease
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_lease(
  p_workspace_id uuid,
  p_agent_name   text,
  p_runtime_id   uuid,
  p_limit        int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_worker_id   uuid;
  v_outbox_id   uuid;
  v_task_id     uuid;
  v_attempt     int;
  v_exec_id     uuid;
  v_task_ver    int;
  v_lease_exp   timestamptz;
  v_receipt     text;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 1 THEN
    RETURN public.ops_error('invalid_request', 'lease limit must be 1 (0.9).');
  END IF;

  v_worker_id := public.ops_ensure_worker(p_workspace_id, p_agent_name);
  IF v_worker_id IS NULL THEN
    RETURN public.ops_error('agent_not_allowed', 'agent worker could not be resolved.');
  END IF;

  SELECT o.id, o.task_id, o.attempt
    INTO v_outbox_id, v_task_id, v_attempt
  FROM public.dispatch_outbox o
  WHERE o.workspace_id = p_workspace_id
    AND o.agent_name = p_agent_name
    AND o.status = 'pending'
  ORDER BY o.created_at
  LIMIT 1
  FOR UPDATE OF o SKIP LOCKED;

  IF v_outbox_id IS NULL THEN
    RETURN jsonb_build_object('job', NULL::jsonb);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = v_task_id AND active_claim_id IS NOT NULL
  ) THEN
    RETURN public.ops_error('task_already_claimed', 'task already has an open execution.');
  END IF;

  v_lease_exp := now() + interval '20 minutes';

  INSERT INTO public.task_executions (
    task_id, workspace_id, agent_name, runtime_id, status, attempt, expires_at
  ) VALUES (
    v_task_id, p_workspace_id, p_agent_name, p_runtime_id, 'open', v_attempt, v_lease_exp
  )
  RETURNING id INTO v_exec_id;

  PERFORM set_config('onitask.ops_mutation', '1', true);

  UPDATE public.tasks
  SET "column" = 'in_progress',
      assigned_to = CASE WHEN assigned_to IS NULL THEN v_worker_id ELSE assigned_to END,
      active_claim_id = v_exec_id,
      moved_to_column_at = now()
  WHERE id = v_task_id
  RETURNING version INTO v_task_ver;

  UPDATE public.dispatch_outbox
  SET status = 'published', published_at = now()
  WHERE id = v_outbox_id;

  v_receipt := 'rcpt_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.dispatch_receipts (receipt, execution_id, outbox_id, workspace_id)
  VALUES (v_receipt, v_exec_id, v_outbox_id, p_workspace_id);

  RETURN jsonb_build_object('job', jsonb_build_object(
    'execution_id', v_exec_id,
    'task_id', v_task_id,
-- ---------------------------------------------------------------------------
-- 2. ops_heartbeat — extend lease VT (fencing: owner runtime + open + grace)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_heartbeat(
  p_execution_id uuid,
  p_runtime_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_exec public.task_executions%ROWTYPE;
  v_new_exp timestamptz;
BEGIN
  SELECT * INTO v_exec
  FROM public.task_executions
  WHERE id = p_execution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.ops_error('execution_not_found', 'execution not found.');
  END IF;

  IF v_exec.runtime_id IS DISTINCT FROM p_runtime_id THEN
    RETURN public.ops_error('stale_claim', 'runtime_id does not own this execution.');
  END IF;

  IF v_exec.status <> 'open' THEN
    RETURN public.ops_error('stale_claim', 'execution is not open.');
  END IF;

  IF v_exec.expires_at < now() - interval '30 seconds' THEN
    RETURN public.ops_error('lease_expired', 'lease is expired beyond grace.');
  END IF;

  v_new_exp := now() + interval '20 minutes';

  UPDATE public.task_executions
  SET expires_at = v_new_exp, heartbeat_at = now()
  WHERE id = p_execution_id;

  RETURN jsonb_build_object(
-- ---------------------------------------------------------------------------
-- 3. ops_terminal — fenced agent completion (review|escalate|handoff)
-- ---------------------------------------------------------------------------
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
  v_new_version   int;
  v_target_column text;
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

  -- Idempotency: same outcome replay на closed → 200 (док. 01 §3)
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

  -- CAS: version сверяется, но НИКОГДА не пишется функцией (G5 — триггер 046)
  IF v_exec.current_version IS DISTINCT FROM p_task_version THEN
    RETURN public.ops_error('version_conflict', 'task version changed since lease (CAS).');
  END IF;

  PERFORM set_config('onitask.ops_mutation', '1', true);

  IF p_outcome = 'review' THEN
    UPDATE public.tasks
    SET "column" = 'review',
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object('ops_terminal_summary', p_summary)
    WHERE id = p_task_id;
    v_target_column := 'review';

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
      -- R7: agent next → domain assign + dispatch_outbox
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
        substring(p_next_owner from 7),
        1,
        jsonb_build_object('handoff_of', v_exec.id, 'handoff_to', p_next_owner)
      )
      ON CONFLICT (task_id) WHERE status = 'pending' DO NOTHING;
      v_target_column := v_exec.task_column;

    ELSIF p_next_owner = 'human' THEN
      UPDATE public.tasks
      SET assigned_to = NULL,
          needs_human = true,
          escalation_reason = coalesce(p_metadata->>'escalation_reason', p_summary, 'handoff'),
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('ops_terminal_summary', p_summary)
      WHERE id = p_task_id;
      v_target_column := v_exec.task_column;

    ELSE
      RETURN public.ops_error('invalid_request', 'handoff next_owner must be agent:<name> or human.');
    END IF;
  END IF;

  -- Close execution + clear claim (version инкрементится триггером 046)
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

  -- Audit + reason source для bot-notify (G7): tool='ops_terminal'
  INSERT INTO public.agent_events (workspace_id, agent_name, tool, task_id, summary, metadata, state_before)
  VALUES (
    v_exec.workspace_id, v_exec.agent_name, 'ops_terminal', p_task_id,
    p_outcome,
    jsonb_build_object('outcome', p_outcome, 'summary', p_summary, 'execution_id', p_execution_id, 'reason', p_summary),
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
  'Arch 0.9: fenced agent completion. Idempotent same-outcome replay → 200; different → 409 claim_closed; stale → 409 stale_claim; CAS mismatch → 409 version_conflict. Never writes version (trigger 046 owns it).';
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
    'execution_id', p_execution_id,
    'status', 'open',
    'lease_expires_at', v_new_exp,
    'heartbeat_at', now()
  );
END;
$$;
    'workspace_id', p_workspace_id,
-- ---------------------------------------------------------------------------
-- 4. ops_ack — delivery receipt after terminal (strict: ack без terminal → 409)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_ack(
  p_execution_id uuid,
  p_runtime_id   uuid,
  p_receipt      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_exec record;
  v_rcpt text;
BEGIN
  SELECT e.* INTO v_exec
  FROM public.task_executions e
  WHERE e.id = p_execution_id;

  IF NOT FOUND THEN
    RETURN public.ops_error('execution_not_found', 'execution not found.');
-- ---------------------------------------------------------------------------
-- 5. ops_nack — reject delivery/accept failure (НЕ business terminal)
-- ---------------------------------------------------------------------------
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
SET search_path = 'public'
AS $$
DECLARE
  v_exec record;
BEGIN
  IF p_reason NOT IN ('unsupported_task', 'runtime_busy', 'dependency_unavailable', 'transient_error', 'other') THEN
    RETURN public.ops_error('invalid_request', 'unrecognized nack reason.');
  END IF;

  SELECT e.* INTO v_exec
  FROM public.task_executions e
  WHERE e.id = p_execution_id;

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

  -- Закрываем execution как failed/expired и снимаем claim (Reaper policy 09 §Nack)
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

  -- unsupported_task → escalate (никакого бесконечного ретрая)
  IF p_reason = 'unsupported_task' THEN
    UPDATE public.tasks
    SET needs_human = true,
        escalation_reason = 'unsupported_task',
        metadata = COALESCE(metadata, '{}'::jsonb) ||
          jsonb_build_object('nack_reason', p_reason, 'nack_detail', p_detail)
    WHERE id = v_exec.task_id;
  ELSE
    -- transient/runtime_busy/dependency → requeue под max_attempts (reaper policy)
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
            jsonb_build_object('nack_reason', p_reason, 'max_attempts_exceeded', true)
      WHERE id = v_exec.task_id;
    END IF;
  END IF;

  -- Audit
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

COMMENT ON FUNCTION public.ops_nack IS
  'Arch 0.9: delivery/accept failure, не business terminal. unsupported_task → escalate; иначе requeue под max_attempts=3; на пределе → escalate max_attempts.';
  END IF;

  IF v_exec.runtime_id IS DISTINCT FROM p_runtime_id THEN
    RETURN public.ops_error('stale_claim', 'runtime_id does not own this execution.');
  END IF;

  -- Strict 0.9: ack требует terminal (док. 01 §4)
  IF v_exec.status <> 'closed' THEN
    RETURN public.ops_error('terminal_required', 'ack requires a preceding ops_terminal.');
  END IF;

  -- Idempotent: существующий receipt → просто подтверждаем
  SELECT receipt INTO v_rcpt
  FROM public.dispatch_receipts
  WHERE execution_id = p_execution_id;

  IF v_rcpt IS NULL THEN
    v_rcpt := 'rcpt_' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.dispatch_receipts (receipt, execution_id, workspace_id)
    VALUES (v_rcpt, p_execution_id, v_exec.workspace_id);
  END IF;

  IF p_receipt IS NOT NULL AND p_receipt <> v_rcpt THEN
    RETURN public.ops_error('stale_claim', 'receipt does not match this execution.');
  END IF;

  UPDATE public.dispatch_receipts
  SET acked_at = now()
  WHERE execution_id = p_execution_id;

  RETURN jsonb_build_object(
    'execution_id', p_execution_id,
    'receipt', v_rcpt,
    'acked', true
  );
END;
$$;

COMMENT ON FUNCTION public.ops_ack IS
  'Arch 0.9: strict ack — terminal обязателен (409 terminal_required); idempotent.';
    'agent_name', p_agent_name,
    'runtime_id', p_runtime_id,
    'attempt', v_attempt,
    'task_version', v_task_ver,
    'lease_expires_at', v_lease_exp,
    'heartbeat_interval_seconds', 60,
    'receipt', v_receipt
  ));
END;
$$;
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object('error', jsonb_build_object('code', p_code, 'message', p_message, 'details', p_details));
$$;