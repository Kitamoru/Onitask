-- ============================================================================
-- 097_task_block_relations_ui.sql
-- AGENT-04/09 — atomic explicit task blockers for the TWA.
--
-- No new table: task_relations remains the source of truth. User UI creates
-- only relation_type='blocks'. is_blocked is synchronized from active blockers
-- on relation insert/delete and when a completed blocker is reopened.
-- ============================================================================

-- 1. Derive one task's is_blocked from non-done incoming `blocks` edges.
CREATE OR REPLACE FUNCTION public.sync_task_blocked_state(
  p_workspace_id uuid,
  p_task_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_blocked boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.task_relations tr
    JOIN public.tasks blocker
      ON blocker.id = tr.from_task_id
     AND blocker.workspace_id = tr.workspace_id
    WHERE tr.workspace_id = p_workspace_id
      AND tr.to_task_id = p_task_id
      AND tr.relation_type = 'blocks'
      AND blocker."column" <> 'done'
  ) INTO v_is_blocked;

  UPDATE public.tasks t
     SET is_blocked = v_is_blocked,
         updated_at = now()
   WHERE t.id = p_task_id
     AND t.workspace_id = p_workspace_id
     AND t."column" <> 'done'
     AND t.is_blocked IS DISTINCT FROM v_is_blocked;

  RETURN v_is_blocked;
END;
$$;

COMMENT ON FUNCTION public.sync_task_blocked_state(uuid, uuid) IS
  'Recomputes tasks.is_blocked from incoming non-done blocks edges. INV-09 version is bumped by trg_bump_task_version when the value changes.';

-- Repair cycle detection. The deployed function referenced a recursive helper
-- that was never present. Keep the existing public contract and implement the
-- bounded DFS as one recursive CTE.
CREATE OR REPLACE FUNCTION public.detect_circular_dependency(
  p_workspace_id uuid,
  p_from_task_id uuid,
  p_to_task_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_cycle boolean;
BEGIN
  IF p_from_task_id = p_to_task_id THEN
    RETURN true;
  END IF;

  WITH RECURSIVE dependency_path(task_id, path) AS (
    -- Adding from -> to means `to` now depends on `from`. It is cyclic when
    -- `from` already depends on `to`, so walk incoming blockers from -> to.
    SELECT p_from_task_id, ARRAY[p_from_task_id]::uuid[]
    UNION ALL
    SELECT tr.from_task_id, dp.path || tr.from_task_id
    FROM dependency_path dp
    JOIN public.task_relations tr
      ON tr.workspace_id = p_workspace_id
     AND tr.to_task_id = dp.task_id
     AND tr.relation_type = 'blocks'
    WHERE tr.from_task_id <> ALL(dp.path)
      AND COALESCE(array_length(dp.path, 1), 0) < 100
  )
  SELECT EXISTS (
    SELECT 1 FROM dependency_path WHERE task_id = p_to_task_id
  ) INTO v_has_cycle;

  RETURN v_has_cycle;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_circular_dependency(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_circular_dependency(uuid, uuid, uuid) TO service_role;

-- 2. Validate every writer, including legacy MCP direct INSERTs.
CREATE OR REPLACE FUNCTION public.validate_task_relation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.from_task_id = NEW.to_task_id THEN
    RAISE EXCEPTION 'task_cannot_block_itself' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize graph mutations per workspace so parallel requests cannot both
  -- pass cycle detection and then create a cycle.
  PERFORM 1
  FROM public.workspaces w
  WHERE w.id = NEW.workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = NEW.from_task_id
      AND t.workspace_id = NEW.workspace_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = NEW.to_task_id
      AND t.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'task_not_in_workspace' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.relation_type = 'blocks' AND NEW.weight <> 1.0 THEN
    RAISE EXCEPTION 'invalid_blocks_weight' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.relation_type = 'blocks'
     AND public.detect_circular_dependency(
       NEW.workspace_id,
       NEW.from_task_id,
       NEW.to_task_id
     ) THEN
    RAISE EXCEPTION 'circular_dependency' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_task_relation ON public.task_relations;
CREATE TRIGGER trg_validate_task_relation
BEFORE INSERT OR UPDATE OF workspace_id, from_task_id, to_task_id, relation_type, weight
ON public.task_relations
FOR EACH ROW
EXECUTE FUNCTION public.validate_task_relation();

-- 3. Synchronize the dependent task after relation graph changes.
CREATE OR REPLACE FUNCTION public.sync_task_relation_blocked_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.relation_type = 'blocks' THEN
      PERFORM public.sync_task_blocked_state(OLD.workspace_id, OLD.to_task_id);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.relation_type = 'blocks' THEN
    PERFORM public.sync_task_blocked_state(OLD.workspace_id, OLD.to_task_id);
  END IF;

  IF NEW.relation_type = 'blocks' THEN
    PERFORM public.sync_task_blocked_state(NEW.workspace_id, NEW.to_task_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_task_relation_blocked_state ON public.task_relations;
CREATE TRIGGER trg_sync_task_relation_blocked_state
AFTER INSERT OR UPDATE OR DELETE ON public.task_relations
FOR EACH ROW
EXECUTE FUNCTION public.sync_task_relation_blocked_state();

-- 4. If a done blocker is reopened, its downstream tasks become blocked again.
-- The WHEN clause intentionally excludes transitions INTO done: the existing
-- trg_cascade_unblock owns those transitions and the cascade notification.
CREATE OR REPLACE FUNCTION public.reblock_downstream_from_reopened_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.tasks dependent
     SET is_blocked = true,
         updated_at = now()
    FROM public.task_relations tr
   WHERE tr.workspace_id = NEW.workspace_id
     AND tr.from_task_id = NEW.id
     AND tr.to_task_id = dependent.id
     AND tr.relation_type = 'blocks'
     AND dependent.workspace_id = NEW.workspace_id
     AND dependent."column" <> 'done'
     AND dependent.is_blocked = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reblock_downstream_from_reopened_task ON public.tasks;
CREATE TRIGGER trg_reblock_downstream_from_reopened_task
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW
WHEN (
  OLD."column" = 'done'
  AND NEW."column" IS DISTINCT FROM 'done'
)
EXECUTE FUNCTION public.reblock_downstream_from_reopened_task();

-- 5. Service-only atomic RPCs for the TWA Route Handler.
CREATE OR REPLACE FUNCTION public.create_task_block_relation(
  p_workspace_id uuid,
  p_from_task_id uuid,
  p_to_task_id uuid,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relation_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tasks blocker
    WHERE blocker.id = p_from_task_id
      AND blocker.workspace_id = p_workspace_id
      AND blocker."column" = 'done'
  ) THEN
    RAISE EXCEPTION 'blocker_already_done' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tasks dependent
    WHERE dependent.id = p_to_task_id
      AND dependent.workspace_id = p_workspace_id
      AND dependent."column" = 'done'
  ) THEN
    RAISE EXCEPTION 'dependent_already_done' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.task_relations (
    workspace_id,
    from_task_id,
    to_task_id,
    relation_type,
    weight,
    created_by
  ) VALUES (
    p_workspace_id,
    p_from_task_id,
    p_to_task_id,
    'blocks',
    1.0,
    p_created_by
  )
  RETURNING id INTO v_relation_id;

  RETURN v_relation_id;
END;
$$;

COMMENT ON FUNCTION public.create_task_block_relation(uuid, uuid, uuid, uuid) IS
  'Creates one explicit blocks edge and synchronizes is_blocked atomically. service_role only; caller performs Telegram membership checks.';

CREATE OR REPLACE FUNCTION public.delete_task_block_relation(
  p_workspace_id uuid,
  p_task_id uuid,
  p_relation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relation public.task_relations%ROWTYPE;
  v_affected public.tasks%ROWTYPE;
BEGIN
  SELECT tr.* INTO v_relation
  FROM public.task_relations tr
  WHERE tr.id = p_relation_id
    AND tr.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relation_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_relation.relation_type <> 'blocks' THEN
    RAISE EXCEPTION 'only_blocks_are_supported' USING ERRCODE = 'P0001';
  END IF;

  IF v_relation.from_task_id <> p_task_id
     AND v_relation.to_task_id <> p_task_id THEN
    RAISE EXCEPTION 'relation_not_for_task' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.task_relations tr WHERE tr.id = v_relation.id;

  SELECT t.* INTO v_affected
  FROM public.tasks t
  WHERE t.id = v_relation.to_task_id
    AND t.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'relation_id', v_relation.id,
    'affected_task', jsonb_build_object(
      'id', v_affected.id,
      'is_blocked', v_affected.is_blocked,
      'version', v_affected.version,
      'updated_at', v_affected.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.delete_task_block_relation(uuid, uuid, uuid) IS
  'Deletes an incident blocks edge and synchronizes is_blocked atomically. service_role only; caller performs Telegram membership checks.';


REVOKE ALL ON FUNCTION public.sync_task_blocked_state(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_task_relation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_task_relation_blocked_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reblock_downstream_from_reopened_task() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_task_block_relation(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_task_block_relation(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_task_blocked_state(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_task_relation() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_task_relation_blocked_state() TO service_role;
GRANT EXECUTE ON FUNCTION public.reblock_downstream_from_reopened_task() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_task_block_relation(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_task_block_relation(uuid, uuid, uuid) TO service_role;

-- Relations UI is server-side only. TWA has no Supabase JWT and calls the
-- resource-scoped Route Handlers with service_role.
DROP POLICY IF EXISTS members_can_view_task_relations ON public.task_relations;
DROP POLICY IF EXISTS members_can_create_task_relations ON public.task_relations;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.task_relations FROM anon, authenticated;

-- 6. Repair any pre-existing stale flags without touching valid tasks.
UPDATE public.tasks t
   SET is_blocked = EXISTS (
       SELECT 1
       FROM public.task_relations tr
       JOIN public.tasks blocker ON blocker.id = tr.from_task_id
       WHERE tr.workspace_id = t.workspace_id
         AND tr.to_task_id = t.id
         AND tr.relation_type = 'blocks'
         AND blocker."column" <> 'done'
   ),
   updated_at = now()
 WHERE t."column" <> 'done'
   AND t.is_blocked IS DISTINCT FROM EXISTS (
       SELECT 1
       FROM public.task_relations tr
       JOIN public.tasks blocker ON blocker.id = tr.from_task_id
       WHERE tr.workspace_id = t.workspace_id
         AND tr.to_task_id = t.id
         AND tr.relation_type = 'blocks'
         AND blocker."column" <> 'done'
   );
