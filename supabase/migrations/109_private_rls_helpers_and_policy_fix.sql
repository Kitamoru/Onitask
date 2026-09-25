-- ============================================================================
-- 109_private_rls_helpers_and_policy_fix.sql
-- Phase 1: break RLS self-recursion without changing table grants or public wrappers.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS onitask_private;
REVOKE ALL ON SCHEMA onitask_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA onitask_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION onitask_private.user_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT w.workspace_id
  FROM public.workers w
  WHERE w.source_id = (SELECT auth.uid())::text
    AND w.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION onitask_private.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workers w
    WHERE w.workspace_id = p_workspace_id
      AND w.source_id = (SELECT auth.uid())::text
      AND w.role IN ('owner', 'admin')
      AND w.is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION onitask_private.is_workspace_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.owner_id = (SELECT auth.uid())::uuid
  );
$function$;

REVOKE ALL ON FUNCTION onitask_private.user_workspace_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION onitask_private.is_workspace_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION onitask_private.is_workspace_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION onitask_private.user_workspace_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION onitask_private.is_workspace_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION onitask_private.is_workspace_owner(uuid) TO authenticated, service_role;

COMMENT ON SCHEMA onitask_private IS
  'Private RLS helpers. Not exposed through the Data API; owned by postgres for BYPASSRLS membership reads.';
COMMENT ON FUNCTION onitask_private.user_workspace_ids() IS
  'Active workspace IDs for auth.uid(); bypasses workers RLS to break policy recursion.';
COMMENT ON FUNCTION onitask_private.is_workspace_admin(uuid) IS
  'True when auth.uid() is an active owner/admin worker in the workspace.';
COMMENT ON FUNCTION onitask_private.is_workspace_owner(uuid) IS
  'True when auth.uid() is the workspace owner_id.';

-- workers
DROP POLICY IF EXISTS workers_select ON public.workers;
CREATE POLICY workers_select ON public.workers
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS workers_update ON public.workers;
CREATE POLICY workers_update ON public.workers
  FOR UPDATE TO authenticated
  USING (
    source_id = (SELECT auth.uid())::text
    OR onitask_private.is_workspace_admin(workspace_id)
  )
  WITH CHECK (
    source_id = (SELECT auth.uid())::text
    OR onitask_private.is_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS workers_insert ON public.workers;
CREATE POLICY workers_insert ON public.workers
  FOR INSERT TO authenticated
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workers_delete ON public.workers;
CREATE POLICY workers_delete ON public.workers
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));

-- tasks
DROP POLICY IF EXISTS members_can_view_tasks ON public.tasks;
CREATE POLICY members_can_view_tasks ON public.tasks
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS members_can_insert_tasks ON public.tasks;
CREATE POLICY members_can_insert_tasks ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS members_can_update_own_tasks ON public.tasks;
CREATE POLICY members_can_update_own_tasks ON public.tasks
  FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS members_can_delete_tasks ON public.tasks;
CREATE POLICY members_can_delete_tasks ON public.tasks
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));

-- workspaces
DROP POLICY IF EXISTS members_can_view_workspaces ON public.workspaces;
CREATE POLICY members_can_view_workspaces ON public.workspaces
  FOR SELECT TO authenticated
  USING (id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS members_can_update_own_workspaces ON public.workspaces;
CREATE POLICY members_can_update_own_workspaces ON public.workspaces
  FOR UPDATE TO authenticated
  USING (onitask_private.is_workspace_admin(id))
  WITH CHECK (onitask_private.is_workspace_admin(id));

-- sprints
DROP POLICY IF EXISTS sprints_policy ON public.sprints;
CREATE POLICY sprints_policy ON public.sprints
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS sprints_insert ON public.sprints;
CREATE POLICY sprints_insert ON public.sprints
  FOR INSERT TO authenticated
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS sprints_update ON public.sprints;
CREATE POLICY sprints_update ON public.sprints
  FOR UPDATE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id))
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS sprints_delete ON public.sprints;
CREATE POLICY sprints_delete ON public.sprints
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));

-- invite links
DROP POLICY IF EXISTS invite_links_policy ON public.invite_links;
CREATE POLICY invite_links_policy ON public.invite_links
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS invite_links_insert ON public.invite_links;
CREATE POLICY invite_links_insert ON public.invite_links
  FOR INSERT TO authenticated
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS invite_links_update ON public.invite_links;
CREATE POLICY invite_links_update ON public.invite_links
  FOR UPDATE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id))
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS invite_links_delete ON public.invite_links;
CREATE POLICY invite_links_delete ON public.invite_links
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));

-- workspace links
DROP POLICY IF EXISTS workspace_links_policy ON public.workspace_links;
CREATE POLICY workspace_links_policy ON public.workspace_links
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS workspace_links_insert ON public.workspace_links;
CREATE POLICY workspace_links_insert ON public.workspace_links
  FOR INSERT TO authenticated
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workspace_links_update ON public.workspace_links;
CREATE POLICY workspace_links_update ON public.workspace_links
  FOR UPDATE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id))
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workspace_links_delete ON public.workspace_links;
CREATE POLICY workspace_links_delete ON public.workspace_links
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));

-- workspace settings
DROP POLICY IF EXISTS members_can_view_workspace_settings ON public.workspace_settings;
CREATE POLICY members_can_view_workspace_settings ON public.workspace_settings
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS owners_can_update_workspace_settings ON public.workspace_settings;
CREATE POLICY owners_can_update_workspace_settings ON public.workspace_settings
  FOR UPDATE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id))
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

-- telegram chat bindings
DROP POLICY IF EXISTS workspace_telegram_chats_policy ON public.workspace_telegram_chats;
CREATE POLICY workspace_telegram_chats_policy ON public.workspace_telegram_chats
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS workspace_telegram_chats_insert ON public.workspace_telegram_chats;
CREATE POLICY workspace_telegram_chats_insert ON public.workspace_telegram_chats
  FOR INSERT TO authenticated
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workspace_telegram_chats_update ON public.workspace_telegram_chats;
CREATE POLICY workspace_telegram_chats_update ON public.workspace_telegram_chats
  FOR UPDATE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id))
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workspace_telegram_chats_delete ON public.workspace_telegram_chats;
CREATE POLICY workspace_telegram_chats_delete ON public.workspace_telegram_chats
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));

-- documents and chunks
DROP POLICY IF EXISTS members_can_view_documents ON public.workspace_documents;
CREATE POLICY members_can_view_documents ON public.workspace_documents
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS members_can_upload_documents ON public.workspace_documents;
CREATE POLICY members_can_upload_documents ON public.workspace_documents
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS members_can_view_doc_chunks ON public.workspace_doc_chunks;
CREATE POLICY members_can_view_doc_chunks ON public.workspace_doc_chunks
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

-- task history
DROP POLICY IF EXISTS members_can_view_task_column_history ON public.task_column_history;
CREATE POLICY members_can_view_task_column_history ON public.task_column_history
  FOR SELECT TO authenticated
  USING (
    task_id IN (
      SELECT t.id
      FROM public.tasks t
      WHERE t.workspace_id IN (SELECT onitask_private.user_workspace_ids())
    )
  );

DROP POLICY IF EXISTS members_can_view_assignment_history ON public.assignment_history;
CREATE POLICY members_can_view_assignment_history ON public.assignment_history
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

-- MCP keys
DROP POLICY IF EXISTS members_select_own_workspace_keys_on_mcp_agent_keys ON public.mcp_agent_keys;
CREATE POLICY members_select_own_workspace_keys_on_mcp_agent_keys ON public.mcp_agent_keys
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

-- task artifacts
DROP POLICY IF EXISTS task_attachments_select_member ON public.task_attachments;
CREATE POLICY task_attachments_select_member ON public.task_attachments
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS task_submissions_select_member ON public.task_submissions;
CREATE POLICY task_submissions_select_member ON public.task_submissions
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

DROP POLICY IF EXISTS task_comments_select_member ON public.task_comments;
CREATE POLICY task_comments_select_member ON public.task_comments
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT onitask_private.user_workspace_ids()));

-- tracker.columns: policies only; no schema USAGE grant in Phase 1.
DROP POLICY IF EXISTS columns_policy ON tracker.columns;
CREATE POLICY columns_policy ON tracker.columns
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT onitask_private.user_workspace_ids())
    OR onitask_private.is_workspace_owner(workspace_id)
  );

DROP POLICY IF EXISTS columns_insert ON tracker.columns;
CREATE POLICY columns_insert ON tracker.columns
  FOR INSERT TO authenticated
  WITH CHECK (onitask_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS columns_update ON tracker.columns;
CREATE POLICY columns_update ON tracker.columns
  FOR UPDATE TO authenticated
  USING (
    onitask_private.is_workspace_admin(workspace_id)
    OR onitask_private.is_workspace_owner(workspace_id)
  )
  WITH CHECK (
    onitask_private.is_workspace_admin(workspace_id)
    OR onitask_private.is_workspace_owner(workspace_id)
  );

DROP POLICY IF EXISTS columns_delete ON tracker.columns;
CREATE POLICY columns_delete ON tracker.columns
  FOR DELETE TO authenticated
  USING (onitask_private.is_workspace_admin(workspace_id));
