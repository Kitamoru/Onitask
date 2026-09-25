-- ============================================================================
-- 110_workers_update_role_guard.sql
-- Preserve the worker role invariant after fixing workers self-update identity.
-- ============================================================================

CREATE OR REPLACE FUNCTION onitask_private.worker_role(p_worker_id uuid)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT w.role
  FROM public.workers w
  WHERE w.id = p_worker_id;
$function$;

REVOKE ALL ON FUNCTION onitask_private.worker_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION onitask_private.worker_role(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION onitask_private.worker_role(uuid) IS
  'Reads the current worker role through BYPASSRLS so workers UPDATE can preserve the role invariant without recursive RLS.';

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
      AND role IS NOT DISTINCT FROM onitask_private.worker_role(id)
    )
  );
