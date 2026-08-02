-- WS-06: Atomic invite link RPCs
-- Two SECURITY DEFINER functions for race-condition-free invite operations.
--
-- 1. accept_invite_link(p_code) — atomic accept (increment used_count + return workspace_id)
--    Pattern: UPDATE...WHERE...RETURNING (A-03 Atomic Quota analog)
--    In Read Committed isolation, concurrent transactions re-evaluate WHERE on
--    the updated row version — second transaction gets 0 rows if max_uses reached.
--
-- 2. create_invite_link(p_workspace_id, p_created_by, p_code) — atomic create
--    Deactivates old active links + inserts new one in a single transaction.
--    Prevents race condition where two concurrent requests could both insert
--    active links, violating idx_one_active_per_workspace (migration 006).

-- =============================================================================
-- 1. accept_invite_link — atomic accept
-- =============================================================================
CREATE OR REPLACE FUNCTION public.accept_invite_link(p_code text)
RETURNS TABLE(workspace_id uuid, invite_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE invite_links
  SET used_count = used_count + 1
  WHERE code = p_code
    AND is_active = true
    AND expires_at > now()
    AND used_count < max_uses
  RETURNING invite_links.workspace_id, invite_links.id;
$$;

-- =============================================================================
-- 2. create_invite_link — atomic create (deactivate old + insert new)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_invite_link(
  p_workspace_id uuid,
  p_created_by   uuid,
  p_code         text
)
RETURNS TABLE(invite_id uuid, code text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Deactivate all previously active links for this workspace
  UPDATE invite_links
  SET is_active = false
  WHERE workspace_id = p_workspace_id
    AND is_active = true;

  -- Insert the new active link and return its id + code
  INSERT INTO invite_links (workspace_id, code, created_by, expires_at, max_uses)
  VALUES (p_workspace_id, p_code, p_created_by, now() + interval '24 hours', 10)
  RETURNING invite_links.id, invite_links.code;
$$;

-- =============================================================================
-- Grants
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.accept_invite_link(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_invite_link(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_invite_link(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_invite_link(uuid, uuid, text) TO authenticated;