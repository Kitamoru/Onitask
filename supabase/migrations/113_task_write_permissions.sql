-- ============================================================================
-- 113_task_write_permissions.sql
-- onitask · Права на запись в задачу (TASK-PERM)
--
-- Баг (2026-09-25): участник доски (role='member') мог редактировать и удалять
-- любые задачи своего воркспейса, в том числе созданные другими людьми.
--
-- Где была дыра (важно для понимания, почему одной RLS мало):
--   1. `members_can_update_own_tasks` названа «own», но условие проверяло только
--      членство в воркспейсе — авторство не учитывалось вообще.
--   2. `DELETE /api/tasks/[id]` в RLS уже требовал admin, но Route Handler
--      работает через SUPABASE_SERVICE_ROLE_KEY (BYPASSRLS) и проверял только
--      `isWorkspaceMember` → политика delete не применялась никогда.
-- Основной фикс — в Route Handler (миграций БД он не заменяет). Эта миграция
-- приводит RLS в соответствие с той же моделью, чтобы прямой доступ через
-- Data API (anon/authenticated) был ограничен так же.
--
-- Правило (согласовано 2026-09-25, совпадает с моделью review-решения
-- из миграций 049/083 — см. src/lib/taskPermissions.ts, единый источник истины):
--   · owner/admin — всё;
--   · автор (created_by) — UPDATE + DELETE;
--   · исполнитель (assigned_to) — UPDATE, но не DELETE;
--   · остальные участники — ничего.
--
-- self-claim («взять задачу в работу») в RLS НЕ выражается намеренно:
--   это разовое назначение assigned_to = свой worker, проверяется в Route Handler
--   (PATCH). В Data API участник и так не может назначить исполнителя —
--   assigned_to остаётся недоступным для canEdit=false, как и раньше.
--
-- Все проверки идут через onitask_private-хелперы (owner=postgres, BYPASSRLS).
-- Прямой подзапрос `FROM public.workers` внутри политики workers-таблицы вернул бы
-- 42P17 infinite recursion (см. миграцию 109).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Хелперы доступа к записи в задачу (только чтение, без SECURITY DEFINER-эскалации
--    сверх уже действующей модели воркспейса)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION onitask_private.can_edit_task(
  p_workspace_id uuid,
  p_created_by   uuid,
  p_assigned_to  uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    onitask_private.is_workspace_admin(p_workspace_id)
    OR (
      p_created_by IS NOT NULL
      AND p_created_by IN (
        SELECT w.id
        FROM public.workers w
        WHERE w.workspace_id = p_workspace_id
          AND w.source_id = (SELECT auth.uid())::text
          AND w.is_active = true
      )
    )
    OR (
      p_assigned_to IS NOT NULL
      AND p_assigned_to IN (
        SELECT w.id
        FROM public.workers w
        WHERE w.workspace_id = p_workspace_id
          AND w.source_id = (SELECT auth.uid())::text
          AND w.is_active = true
      )
    );
$$;

CREATE OR REPLACE FUNCTION onitask_private.can_delete_task(
  p_workspace_id uuid,
  p_created_by   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    onitask_private.is_workspace_admin(p_workspace_id)
    OR (
      p_created_by IS NOT NULL
      AND p_created_by IN (
        SELECT w.id
        FROM public.workers w
        WHERE w.workspace_id = p_workspace_id
          AND w.source_id = (SELECT auth.uid())::text
          AND w.is_active = true
      )
    );
$$;

COMMENT ON FUNCTION onitask_private.can_edit_task(uuid, uuid, uuid) IS
  'True when auth.uid() is owner/admin of the workspace, the task creator, or the assignee. Действует для UPDATE tasks (перемещение = тот же PATCH).';
COMMENT ON FUNCTION onitask_private.can_delete_task(uuid, uuid) IS
  'True when auth.uid() is owner/admin of the workspace or the task creator. Исполнитель удалять не может.';

REVOKE ALL ON FUNCTION onitask_private.can_edit_task(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION onitask_private.can_edit_task(uuid, uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION onitask_private.can_delete_task(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION onitask_private.can_delete_task(uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Политики tasks: UPDATE и DELETE
-- ---------------------------------------------------------------------------
-- UPDATE покрывает и перемещение между колонками (drag-and-drop, MoveTaskSheet,
-- штрих в карточке) — это тот же PATCH, различается только набор полей.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS members_can_update_own_tasks ON public.tasks;
CREATE POLICY members_can_update_own_tasks ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    onitask_private.can_edit_task(
      workspace_id,
      created_by,
      assigned_to
    )
  )
  WITH CHECK (
    onitask_private.can_edit_task(
      workspace_id,
      created_by,
      assigned_to
    )
  );

DROP POLICY IF EXISTS members_can_delete_tasks ON public.tasks;
CREATE POLICY members_can_delete_tasks ON public.tasks
  FOR DELETE TO authenticated
  USING (
    onitask_private.can_delete_task(workspace_id, created_by)
  );

-- SELECT и INSERT не меняем: видеть и создавать задачи в своём воркспейсе
-- участник по-прежнему может (A-8 «Flow Board доступен всем Members»).
