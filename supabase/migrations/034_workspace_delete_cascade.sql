-- ============================================================
-- onitask · Fix profiles.last_active_workspace_id FK for cascade delete
-- File:    034_workspace_delete_cascade.sql
-- Purpose: Добавить ON DELETE SET NULL для last_active_workspace_id,
--          чтобы удаление доски не блокировалось профилем.
-- Date:    2026-08-18
-- ============================================================

-- Drop existing FK constraint (auto-named by PostgreSQL)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_last_active_workspace_id_fkey;

-- Re-add with ON DELETE SET NULL
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_last_active_workspace_id_fkey
    FOREIGN KEY (last_active_workspace_id) REFERENCES public.workspaces(id)
    ON DELETE SET NULL;