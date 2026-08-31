-- ============================================================================
-- 064_dispatch_producer_and_review_reason.sql
-- Architecture 0.9:
--   G1  Продьюсер первичного dispatch_outbox (назначение задачи агенту).
--   G6  reason из ops_terminal summary в payload task_review (эмиттер уже есть).
--   R7  requeue после ra:fix (assigned_to не меняется → триггер не сработает).
--
-- Находка при реализации: эмиттеры task_started/task_review/esc/done уже
-- работают через column-триггеры (trg_task_started_notify 055,
-- trg_task_review_notify, trg_escalation_alert, trg_task_done_notify) в той же
-- TX, что и UPDATE tasks из ops_lease/ops_terminal — доп. emit-вызовы не нужны.
-- Для G6 достаточно добавить reason ← последний terminal summary.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. G1: продьюсер dispatch_outbox на назначение задачи агенту
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_dispatch_outbox_on_assign()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_worker_type text;
  v_agent_name  text;
BEGIN
  -- Только при назначении (INSERT или смена assigned_to) на активного АГЕНТА
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT type, display_name INTO v_worker_type, v_agent_name
  FROM public.workers
  WHERE id = NEW.assigned_to AND is_active = true;

  IF v_worker_type IS DISTINCT FROM 'agent' THEN
    RETURN NEW;
  END IF;

  -- Агент не получает new-work, если задача уже done
  IF NEW."column" = 'done' THEN
    RETURN NEW;
  END IF;

  -- Не дублируем pending (G4 unique index — страховка; WHERE NOT EXISTS — чистота)
  IF NOT EXISTS (
    SELECT 1 FROM public.dispatch_outbox
    WHERE task_id = NEW.id AND status = 'pending'
  ) THEN
    INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
    VALUES (
      NEW.workspace_id, NEW.id, v_agent_name, 1,
      jsonb_build_object('source', TG_OP, 'assignee', NEW.assigned_to)
    );
  END IF;

  RETURN NEW;
END;
$$;
-- ---------------------------------------------------------------------------
-- 2. R7: review_action(ra:fix) — requeue задачи агенту
--    assigned_to НЕ меняется при fix, поэтому assignment-триггер не сработает
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_action(
  p_task_id uuid,
  p_action text,
  p_version integer,
  p_actor_worker_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace_id   uuid;
  v_column         text;
  v_reviewer_id    uuid;
  v_version        int;
  v_review_pending text;
  v_new_column     text;
  v_metadata       jsonb;
  v_agent_name     text;
BEGIN
  IF p_action NOT IN ('approve', 'fix') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END IF;

  SELECT workspace_id, "column", reviewer_id, version,
         metadata->>'review_pending', metadata
    INTO v_workspace_id, v_column, v_reviewer_id, v_version, v_review_pending, v_metadata
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('success', false, 'error', 'version_conflict');
  END IF;

  IF v_column IS DISTINCT FROM 'review' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;

  IF v_reviewer_id IS NULL
     AND COALESCE(v_review_pending, 'false') <> 'true' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workers
    WHERE id = p_actor_worker_id
      AND workspace_id = v_workspace_id
      AND type = 'human'
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_new_column := CASE p_action WHEN 'approve' THEN 'done' ELSE 'in_progress' END;

  v_metadata := COALESCE(v_metadata, '{}'::jsonb) - 'review_pending';
  IF p_action = 'fix' AND p_reason IS NOT NULL THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{last_fix_reason}',
      to_jsonb(left(p_reason, 2000))
    );
  END IF;

  UPDATE public.tasks
  SET "column"  = v_new_column,
      metadata  = v_metadata,
      updated_at = now()
  WHERE id = p_task_id
    AND version = p_version;
-- ---------------------------------------------------------------------------
-- 3. G6: reason из ops terminal summary в task_review payload
--    (эмиттер trg_task_review_notify уже существует — расширяем payload)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_task_review()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
        'reason',       NEW.metadata->>'ops_terminal_summary'
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.notify_task_review IS
  'G6: задача → review → bot_notify task_review. reason из tasks.metadata.ops_terminal_summary (опубликовано ops_terminal в той же TX).';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'version_conflict');
  END IF;

  -- R7 / G1: requeue агента через outbox (assigned_to при fix не меняется)
  IF p_action = 'fix' THEN
    SELECT display_name INTO v_agent_name
    FROM public.workers
    WHERE id = (SELECT assigned_to FROM public.tasks WHERE id = p_task_id)
      AND type = 'agent'
      AND is_active = true;

    IF v_agent_name IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.dispatch_outbox
        WHERE task_id = p_task_id AND status = 'pending'
      ) THEN
        INSERT INTO public.dispatch_outbox (workspace_id, task_id, agent_name, attempt, payload)
        VALUES (
          v_workspace_id, p_task_id, v_agent_name, 1,
          jsonb_build_object(
            'source', 'review_action_fix',
            'last_fix_reason', left(COALESCE(p_reason, ''), 2000)
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',   true,
    'task_id',   p_task_id,
    'new_column', v_new_column
  );
END;
$function$;

DROP TRIGGER IF EXISTS trg_dispatch_outbox_on_assign ON public.tasks;
CREATE TRIGGER trg_dispatch_outbox_on_assign
  AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_dispatch_outbox_on_assign();

COMMENT ON FUNCTION public.trg_dispatch_outbox_on_assign IS
  'G1: назначение задачи агенту (human /task, TWA, MCP create_task) → dispatch_outbox pending. R7 handoff и ra:fix обрабатываются отдельно.';