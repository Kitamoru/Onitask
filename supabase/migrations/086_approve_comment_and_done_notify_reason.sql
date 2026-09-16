-- ============================================================================
-- 086_approve_comment_and_done_notify_reason.sql
-- onitask · approve-контур: комментарий в фиде + «Результат» в done-уведомлении.
--
--   1. review_action(approve): после move в done — INSERT task_comments
--      (автор = актор, body = «Результат задачи <full_id> согласован.
--      Задача перенесена в Сделано.», source='review') В ТОЙ ЖЕ TX.
--      Единый код для двух каналов: бот-webhook (ra:approve) и TWA-роут
--      POST /api/tasks/[id]/review. source='review' → лента красит комментарий
--      циановым бордером (правило payload.source==='review').
--   2. notify_task_done: + via_review (OLD.column = 'review') и reason
--      (COALESCE ops_terminal_summary, текст последней task_submissions).
--      Edge Function bot-notify различает «согласовано» (done_approved,
--      получатели: постановщик + исполнитель) и обычный move в done.
--      Человеческая сдача (submit_task 082) пишет body_text ДО UPDATE tasks
--      в той же TX — триггер видит submission → строка «Результат:» в бот-
--      карточке перестаёт быть пустой для human-исполнителей (паттерн 083).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. review_action: approve → авто-комментарий «результат согласован»
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

  -- 086: approve → авто-комментарий «результат согласован» в фиде задачи.
  -- Единый канал с fix (083): бот-webhook (ra:approve) и TWA-роут пишут
  -- этим же кодом. source='review' → циановый бордер в ленте.
  IF p_action = 'approve' THEN
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
       format('Результат задачи %s согласован. Задача перенесена в Сделано.',
              public.task_full_id(p_task_id)),
       'review', false);
  END IF;

  RETURN jsonb_build_object(
    'success',   true,
    'task_id',   p_task_id,
    'new_column', v_new_column
  );
END;
$function$;

COMMENT ON FUNCTION public.review_action IS
  'REV-01 (083/086): approve → done + авто-комментарий «результат согласован» (source=review), fix → in_progress + last_fix_reason + комментарий причины + requeue агента через dispatch_outbox. INV-09 CAS по version.';

-- ---------------------------------------------------------------------------
-- 2. notify_task_done: + via_review и reason (паттерн 083)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_task_done()
RETURNS TRIGGER AS $$
BEGIN
  -- Срабатывает только при реальном переходе в done (не из done)
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

DROP TRIGGER IF EXISTS trg_task_done_notify ON public.tasks;
CREATE TRIGGER trg_task_done_notify
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_task_done();

COMMENT ON FUNCTION public.notify_task_done IS
  '048 + 086: джоба task_done при переходе в done. via_review — задача прошла review (→ done_approved в bot-notify, получатели: постановщик + исполнитель); reason — ops_terminal_summary или текст последней task_submissions (паттерн 083).';

-- Проверка: триггер зарегистрирован
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'trg_task_done_notify';