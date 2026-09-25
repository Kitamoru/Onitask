-- Fix recursive membership checks in task attachment/submission RLS.
-- Reuse the existing SECURITY DEFINER workspace-membership helper, which bypasses
-- workers RLS while still deriving the caller's active workspace set from auth.uid().

DROP POLICY IF EXISTS task_attachments_select_member ON public.task_attachments;
CREATE POLICY task_attachments_select_member
  ON public.task_attachments
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT public.get_my_workspace_ids())
  );

DROP POLICY IF EXISTS task_submissions_select_member ON public.task_submissions;
CREATE POLICY task_submissions_select_member
  ON public.task_submissions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT public.get_my_workspace_ids())
  );

-- These helpers are used by RLS, not by the anonymous Data API.
REVOKE EXECUTE ON FUNCTION public.get_my_workspace_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(uuid) FROM anon;