-- ============================================================
-- onitask · Transfer workspace ownership
-- File:    080_transfer_ownership.sql
-- Purpose: 1) Hard invariant "exactly one owner per workspace"
--             (partial unique index on workers).
--          2) Atomic ownership transfer RPC — old owner → admin,
--             target → owner, workspaces.owner_id kept in sync.
-- Date:    2026-09-08
-- ============================================================

-- STEP 1: Dedup safety net — if data drift ever produced >1 owner
-- per workspace, keep the earliest and demote the rest to admin.
WITH dupes AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY workspace_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.workers
  WHERE role = 'owner'
)
UPDATE public.workers
SET role = 'admin'
WHERE role = 'owner'
  AND id IN (SELECT id FROM dupes WHERE rn > 1);

-- STEP 2: Hard DB-level invariant — at most one owner per workspace.
-- transfer_workspace_ownership() demotes the current owner BEFORE promoting
-- the target (single transaction), so the index never rejects a transfer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_owner_per_workspace
  ON public.workers (workspace_id)
  WHERE role = 'owner';

-- STEP 3: Atomic transfer RPC.
-- Security model: callable only by the app layer (service role) —
-- POST /api/workspaces/[id]/transfer-ownership validates that the actor
-- is the workspace owner BEFORE calling this function. The function
-- re-validates the target defensively under row locks.
CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_to_worker_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current_owner_id  uuid;
  v_target_workspace  uuid;
  v_target_role       text;
  v_target_active     boolean;
  v_target_type       text;
  v_new_owner_source  text;
BEGIN
  -- Lock the current owner row (also fails if there is no owner).
  SELECT id INTO v_current_owner_id
  FROM public.workers
  WHERE workspace_id = p_workspace_id
    AND role = 'owner'
  FOR UPDATE;

  IF v_current_owner_id IS NULL THEN
    RAISE EXCEPTION 'owner_not_found';
  END IF;

  -- Lock + validate the target row.
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
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'target_already_owner';
  END IF;
  IF v_current_owner_id = p_to_worker_id THEN
    RAISE EXCEPTION 'cannot_transfer_to_self';
  END IF;

  -- Demote current owner first (keeps uq_one_owner_per_workspace happy),
  -- then promote the target, then keep workspaces.owner_id in sync
  -- (best-effort: the app layer does not maintain owner_id elsewhere;
  -- profiles.id is used as the closest app-level identity).
  UPDATE public.workers
  SET role = 'admin'
  WHERE id = v_current_owner_id;

  UPDATE public.workers
  SET role = 'owner'
  WHERE id = p_to_worker_id;

  -- Keep workspaces.owner_id in sync (best-effort: the app layer does not
  -- maintain owner_id elsewhere). workers.source_id is text; cast to uuid
  -- only when it looks like a valid UUID, otherwise keep the old value.
  SELECT source_id INTO v_new_owner_source
  FROM public.workers
  WHERE id = p_to_worker_id;

  IF v_new_owner_source ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE public.workspaces
    SET owner_id = v_new_owner_source::uuid
    WHERE id = p_workspace_id;
  END IF;
END;
$$;
