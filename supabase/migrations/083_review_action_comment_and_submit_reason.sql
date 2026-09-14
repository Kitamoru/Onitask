-- ============================================================================
-- 083_review_action_comment_and_submit_reason.sql
-- onitask · REV-01: единый review-контур бот + TWA.
--
--   1. task_comments.source += 'review' — причина возврата на доработку
--      попадает в фид задачи как комментарий ревьюера.
--   2. review_action(fix): после move в in_progress — INSERT task_comments
--      (автор = актор, body = причина, source='review') В ТОЙ ЖЕ TX.
--      Единый код для двух каналов: бот-webhook (ra:fix) и TWA-роут
--      POST /api/tasks/[id]/review. p_reason триммится; пустая причина
--      НЕ пишет ни комментарий, ни last_fix_reason (TWA-роут валидирует
--      обязательность сам).
--   3. notify_task_review: reason карточки ревью — теперь COALESCE
--      (ops_terminal_summary, текст последней task_submissions). Человеческая
--      сдача (submit_task 082) пишет body_text ДО UPDATE tasks в той же TX —
--      триггер видит submission → бот-карточка ревьюеру получает «Что сделано»
--      и для human-исполнителей, а не только для агентов.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. task_comments.source: разрешить 'review'
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_comments DROP CONSTRAINT task_comments_source_check;
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_source_check
  CHECK (source = ANY (ARRAY['twa'::text, 'mcp'::text, 'telegram'::text, 'system'::text, 'review'::text]));

COMMENT ON CONSTRAINT task_comments_source_check ON public.task_comments IS
  'REV-01 (083): + review — авто-комментарий причины возврата на доработку (пишет review_action).';

-- ---------------------------------------------------------------------------
-- 2. review_action: fix → комментарий причины в фид
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
  v_metadata       jsonb;
  v_agent_name     text;
  v_author_name    text;
  v_author_type    text;
  v_reason         text;
  v_new_column     text;
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
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF p_action = 'fix' AND v_reason IS NOT NULL THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{last_fix_reason}',
      to_jsonb(left(v_reason, 2000))
    );
  END IF;

  UPDATE public.tasks
  SET "column"  = v_new_column,
      metadata  = v_metadata,
      updated_at = now()
  WHERE id = p_task_id
    AND version = p_version;

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
            'last_fix_reason', left(COALESCE(v_reason, ''), 2000)
          )
        );
      END IF;
    END IF;

    -- REV-01 (083): причина возврата — комментарий в фиде задачи.
    -- Единый канал: бот-webhook (ra:fix) и TWA-роут пишут этим же кодом.
    IF v_reason IS NOT NULL THEN
      SELECT display_name, type INTO v_author_name, v_author_type
      FROM public.workers
      WHERE id = p_actor_worker_id;

      INSERT INTO public.task_comments
        (workspace_id, task_id, author_id, author_name, author_type,
         body, source, consolidated)
      VALUES
        (v_workspace_id, p_task_id, p_actor_worker_id,
         COALESCE(v_author_name, 'Ревьюер'),
         COALESCE(v_author_type, 'human'),
         left(v_reason, 2000), 'review', false);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',   true,
    'task_id',   p_task_id,
    'new_column', v_new_column
  );
END;
$function$;

COMMENT ON FUNCTION public.review_action IS
  'REV-01 (083): approve → done, fix → in_progress. fix + причина → metadata.last_fix_reason + комментарий в task_comments (source=review) + requeue агента через dispatch_outbox. INV-09 CAS по version.';

-- ---------------------------------------------------------------------------
-- 3. notify_task_review: reason = ops_terminal_summary ИЛИ текст сдачи (082)
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
$function$;

COMMENT ON FUNCTION public.notify_task_review IS
  'REV-01 (083): reason карточки ревью — ops_terminal_summary (агент) ИЛИ body_text последней task_submissions (human, submit_task 082 пишет её до UPDATE tasks в той же TX).';
