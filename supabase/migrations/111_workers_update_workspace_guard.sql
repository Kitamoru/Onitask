-- ============================================================================
-- 111_workers_update_workspace_guard.sql
-- Self-update must not move a worker row into another workspace.
-- ============================================================================

CREATE OR REPLACE FUNCTION onitask_private.worker_workspace(p_worker_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT w.workspace_id
  FROM public.workers w
  WHERE w.id = p_worker_id;
$function$;

REVOKE ALL ON FUNCTION onitask_private.worker_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION onitask_private.worker_workspace(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION onitask_private.worker_workspace(uuid) IS
  'Current workspace of a worker row; used to keep self-update tenant-bound.';

DROP POLICY IF EXISTS workers_update ON public.workers;
CREATE POLICY workers_update ON public.workers
  FOR UPDATE TO authenticated
  USING (
    source_id = (SELECT auth.uid())::text
    OR onitask_private.is_workspace_admin(workspace_id)
  )
  WITH CHECK (
    onitask_private.is_workspace_admin(workspace_id)
    OR (
      source_id = (SELECT auth.uid())::text
      AND workspace_id IS NOT DISTINCT FROM onitask_private.worker_workspace(id)
      AND role IS NOT DISTINCT FROM onitask_private.worker_role(id)
    )
  );
