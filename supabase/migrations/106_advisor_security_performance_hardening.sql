-- ============================================================================
-- 106_advisor_security_performance_hardening.sql
-- Supabase Advisor audit: apply only confirmed, low-risk remediations.
-- ============================================================================

-- 1. Covering indexes for foreign keys introduced by FILE-01/SUBMIT-01.
CREATE INDEX IF NOT EXISTS idx_bot_attach_pending_workspace_id
  ON public.bot_attach_pending (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bot_task_messages_task_id
  ON public.bot_task_messages (task_id);
CREATE INDEX IF NOT EXISTS idx_bot_task_messages_workspace_id
  ON public.bot_task_messages (workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploaded_by
  ON public.task_attachments (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_task_attachments_workspace_id
  ON public.task_attachments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_accepted_by
  ON public.task_submissions (accepted_by);
CREATE INDEX IF NOT EXISTS idx_task_submissions_submitted_by
  ON public.task_submissions (submitted_by);

-- 2. Remove indexes proven to duplicate an existing equivalent index.
DROP INDEX IF EXISTS public.idx_profiles_telegram;
DROP INDEX IF EXISTS public.idx_workers_source_id;
DROP INDEX IF EXISTS public.idx_invite_links_code;
DROP INDEX IF EXISTS public.idx_tasks_dedup_key_lookup;
DROP INDEX IF EXISTS public.idx_bot_task_messages_chat;

-- 3. Initplan optimization: evaluate auth.uid() once per policy evaluation.
DROP POLICY IF EXISTS task_attachments_select_member ON public.task_attachments;
CREATE POLICY task_attachments_select_member
  ON public.task_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workers w
      WHERE w.workspace_id = task_attachments.workspace_id
        AND w.is_active = true
        AND w.source_id::text = (SELECT auth.uid())::text
    )
  );

DROP POLICY IF EXISTS task_submissions_select_member ON public.task_submissions;
CREATE POLICY task_submissions_select_member
  ON public.task_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workers w
      WHERE w.workspace_id = task_submissions.workspace_id
        AND w.is_active = true
        AND w.source_id::text = (SELECT auth.uid())::text
    )
  );

-- 4. Service-only tables must not be reachable through anon/authenticated grants.
REVOKE ALL ON TABLE public.agent_connectors FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.bot_attach_pending FROM anon, authenticated;
REVOKE ALL ON TABLE public.bot_review_fix_pending FROM anon, authenticated;
REVOKE ALL ON TABLE public.bot_task_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.dispatch_outbox FROM anon, authenticated;
REVOKE ALL ON TABLE public.dispatch_receipts FROM anon, authenticated;
REVOKE ALL ON TABLE public.task_deadline_notifications FROM anon, authenticated;
REVOKE ALL ON TABLE public.task_executions FROM anon, authenticated;

-- 5. Pin RLS helper functions to an empty search_path.
CREATE OR REPLACE FUNCTION public.get_my_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ws.workspace_id
  FROM public.workers ws
  JOIN public.profiles p ON p.id = auth.uid()
  WHERE ws.source_id = p.id::text
    AND ws.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workers
    WHERE workspace_id = p_workspace_id
      AND role IN ('owner', 'admin')
      AND source_id::text = (SELECT auth.uid())::text
      AND is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = p_workspace_id
      AND owner_id = (SELECT auth.uid())::uuid
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_task_card_data(p_task_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'fullId', ws.task_prefix || '-'::text || t.task_number,
    'title', t.title,
    'description', t.description,
    'column', t."column",
    'isInbox', t.is_inbox,
    'isBlocked', EXISTS (
      SELECT 1
      FROM public.task_relations tr
      JOIN public.tasks dep ON dep.id = tr.from_task_id
      WHERE tr.to_task_id = t.id
        AND dep."column" <> 'done'
    ),
    'priority', CASE
      WHEN t.priority IN ('critical', 'high') THEN 'high'
      WHEN t.priority = 'medium' THEN 'medium'
      WHEN t.priority = 'low' THEN 'low'
      ELSE NULL
    END,
    'dueDate', t.deadline::text,
    'assigneeName', wkr.display_name,
    'assignedByName', cw.display_name,
    'reviewerName', rv.display_name,
    'workspaceHandle', ws.slug,
    'clarityScore', t.clarity_score
  )
  FROM public.tasks t
  JOIN public.workspaces ws ON ws.id = t.workspace_id
  LEFT JOIN public.workers wkr ON wkr.id = t.assigned_to
  LEFT JOIN public.workers cw ON cw.id = t.created_by
  LEFT JOIN public.workers rv ON rv.id = t.reviewer_id
  WHERE t.id = p_task_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_task_card_data_by_full_id(p_full_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.get_task_card_data(public.find_task_by_full_id(p_full_id));
$function$;

CREATE OR REPLACE FUNCTION public.init_workspace_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO tracker.columns (workspace_id, name, system_status, wip_limit, position)
  VALUES
    (NEW.id, 'backlog', 'backlog', 15, 1.0),
    (NEW.id, 'in_progress', 'in_progress', 5, 2.0),
    (NEW.id, 'review', 'review', 4, 3.0),
    (NEW.id, 'done', 'done', NULL, 4.0);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.init_workspace_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.workspace_settings (
    workspace_id, story_points_config, enable_cognitive_budget,
    workspace_context, deadline_signals, velocity_window_days,
    flow_config, realtime_subscription_level, data_sharing_level,
    quota_config, standup_config, doc_kb_config, f04_config
  )
  VALUES (
    NEW.id, '{"enabled":false}', false, NULL,
    '[{"value":3,"label":"3 дня","level":"amber"},{"value":1,"label":"1 день","level":"red"}]',
    14, '{}', 'own_tasks', 'standard',
    '{"agent_reserved_pct":60,"human_min_pct":40}',
    '{"enabled":false,"time_utc":"07:00","chat_id":null}',
    '{"enabled":true,"max_file_bytes":524288,"max_total_bytes":5242880,"max_files":20}',
    '{"skip_min_clarity":0.85,"skip_max_complexity":1,"correction_sheet_clarity_threshold":0.70,"low_clarity_tag_threshold":0.55}'
  )
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_to_worker_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_current_owner_id uuid;
  v_target_workspace uuid;
  v_target_role text;
  v_target_active boolean;
  v_target_type text;
  v_new_owner_source text;
BEGIN
  SELECT id INTO v_current_owner_id
  FROM public.workers
  WHERE workspace_id = p_workspace_id AND role = 'owner'
  FOR UPDATE;
  IF v_current_owner_id IS NULL THEN RAISE EXCEPTION 'owner_not_found'; END IF;

  SELECT workspace_id, role, is_active, type
  INTO v_target_workspace, v_target_role, v_target_active, v_target_type
  FROM public.workers
  WHERE id = p_to_worker_id
  FOR UPDATE;
  IF v_target_workspace IS NULL OR v_target_workspace <> p_workspace_id THEN
    RAISE EXCEPTION 'target_not_in_workspace';
  END IF;
  IF v_target_type <> 'human' OR v_target_active IS NOT TRUE THEN
    RAISE EXCEPTION 'target_not_active_human';
  END IF;
  IF v_target_role = 'owner' THEN RAISE EXCEPTION 'target_already_owner'; END IF;
  IF v_current_owner_id = p_to_worker_id THEN RAISE EXCEPTION 'cannot_transfer_to_self'; END IF;

  UPDATE public.workers SET role = 'admin' WHERE id = v_current_owner_id;
  UPDATE public.workers SET role = 'owner' WHERE id = p_to_worker_id;

  SELECT source_id INTO v_new_owner_source
  FROM public.workers
  WHERE id = p_to_worker_id;
  IF v_new_owner_source ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE public.workspaces
    SET owner_id = v_new_owner_source::uuid
    WHERE id = p_workspace_id;
  END IF;
END;
$function$;

-- 6. Only the trusted server layer may call these RPCs/triggers directly.
REVOKE ALL ON FUNCTION public.get_task_card_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_task_card_data_by_full_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.init_workspace_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.init_workspace_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_workspace_ownership(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_card_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_task_card_data_by_full_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.init_workspace_columns() TO service_role;
GRANT EXECUTE ON FUNCTION public.init_workspace_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_workspace_ownership(uuid, uuid) TO service_role;
