-- ============================================================================
-- 095_preserve_invite_worker_display_name.sql
-- Preserve an existing worker's display name when a former member is
-- reactivated through an invite. Only inactive state is changed.
CREATE OR REPLACE FUNCTION public.accept_invite_link(
  p_code text,
  p_source_id text,
  p_display_name text
)
RETURNS TABLE(workspace_id uuid, invite_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invite_id uuid;
  v_workspace_id uuid;
  v_worker_exists boolean;
BEGIN
  SELECT il.id, il.workspace_id
  INTO v_invite_id, v_workspace_id
  FROM public.invite_links AS il
  WHERE il.code = p_code
    AND il.is_active = true
    AND il.expires_at > now()
    AND il.used_count < il.max_uses
  FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.workers AS w
    WHERE w.workspace_id = v_workspace_id
      AND w.source_id = p_source_id
      AND w.is_active = true
  ) INTO v_worker_exists;

  IF v_worker_exists THEN
    RETURN QUERY SELECT v_workspace_id, v_invite_id;
    RETURN;
  END IF;

  INSERT INTO public.workers (
    workspace_id, source_id, type, role, display_name, is_active
  )
  VALUES (
    v_workspace_id, p_source_id, 'human', 'member',
    COALESCE(NULLIF(p_display_name, ''), p_source_id), true
  )
  ON CONFLICT ON CONSTRAINT workers_workspace_id_source_id_key DO UPDATE
  SET is_active = true;

  UPDATE public.invite_links
  SET used_count = used_count + 1
  WHERE id = v_invite_id;

  RETURN QUERY SELECT v_workspace_id, v_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite_link(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_invite_link(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.accept_invite_link(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite_link(text, text, text) TO service_role;
