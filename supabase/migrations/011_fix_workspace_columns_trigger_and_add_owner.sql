-- ============================================================
-- onitask · Fix workspace columns trigger + add owner column
-- File:    011_fix_workspace_columns_trigger_and_add_owner.sql
-- Purpose: 
--   1. Add owner_id column to public.workspaces
--   2. Make init_workspace_columns() SECURITY DEFINER
--   3. Grant service_role access to tracker schema
--   4. Add RLS policies for owner-based access control
-- Date:    2026-07-20
-- ============================================================

-- STEP 1: Add owner_id column to workspaces
-- Note: No FK to auth.users — auth.users is not directly accessible via FK constraints
-- in all Supabase configurations. The application layer ensures correctness.
-- DEFAULT auth.uid() returns NULL for service_role, so we use NULL default
-- and rely on the application layer to set owner_id explicitly.
ALTER TABLE public.workspaces 
  ADD COLUMN IF NOT EXISTS owner_id uuid;

-- Set owner_id for existing workspaces (if any) to a placeholder
-- This is safe because we're in a migration context
UPDATE public.workspaces 
  SET owner_id = '00000000-0000-0000-0000-000000000000'::uuid
  WHERE owner_id IS NULL;

-- Now make it NOT NULL
ALTER TABLE public.workspaces 
  ALTER COLUMN owner_id SET NOT NULL;

-- Index may already exist, use IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON public.workspaces (owner_id);

-- STEP 2: Create helper function is_workspace_owner
-- SECURITY DEFINER + SET search_path for injection protection (A-02)
CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $_$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = p_workspace_id AND owner_id = auth.uid()::uuid
  );
$_$;

-- STEP 3: Recreate init_workspace_columns as SECURITY DEFINER
-- Drop old version first (ALTER FUNCTION ... SECURITY DEFINER alone may not work
-- when the function was created without SECURITY DEFINER in some Supabase versions)
DROP FUNCTION IF EXISTS public.init_workspace_columns() CASCADE;

CREATE OR REPLACE FUNCTION public.init_workspace_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, tracker AS $$
BEGIN
  INSERT INTO tracker.columns (workspace_id, name, system_status, wip_limit, position)
  VALUES
    (NEW.id, 'backlog',      'backlog',      15, 1.0),
    (NEW.id, 'in_progress',  'in_progress',  5,  2.0),
    (NEW.id, 'review',       'review',       4,  3.0),
    (NEW.id, 'done',         'done',         NULL, 4.0);
  
  RETURN NEW;
END;
$$;

-- Grant service_role access to tracker schema and columns
GRANT USAGE ON SCHEMA tracker TO service_role;
GRANT INSERT ON tracker.columns TO service_role;

-- STEP 4: Attach init_workspace_columns trigger to workspaces table
-- This trigger was created in 001_init.sql but never attached!
DROP TRIGGER IF EXISTS trg_init_workspace_columns ON public.workspaces;
CREATE TRIGGER trg_init_workspace_columns
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.init_workspace_columns();

-- Drop conflicting policies from earlier migrations
-- Note: authenticated_can_create_workspaces requires auth.uid() IS NOT NULL,
-- which doesn't work for Telegram WebApp auth (no JWT). We remove it.
DROP POLICY IF EXISTS authenticated_can_create_workspaces ON public.workspaces;
DROP POLICY IF EXISTS workspaces_insert_service_role ON public.workspaces;

-- Service role can always insert (used by /api/workspaces with SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY workspaces_insert_service_role
  ON public.workspaces
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Anon role can insert if owner_id is provided (fallback when service_role key is missing)
-- This is needed because Telegram WebApp auth uses init_data, not JWT
CREATE POLICY workspaces_insert_anon
  ON public.workspaces
  FOR INSERT
  TO anon
  WITH CHECK (owner_id IS NOT NULL);

-- Authenticated users can create their own workspace (owner_id = auth.uid())
-- For Telegram WebApp: owner_id must be provided explicitly
CREATE POLICY workspaces_insert_own
  ON public.workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id IS NOT NULL);

-- STEP 5: RLS policies for tracker.columns
-- Replace the generic member policy with owner-based access
DROP POLICY IF EXISTS columns_select_member ON tracker.columns;
CREATE POLICY columns_select_owner
  ON tracker.columns
  FOR SELECT
  USING (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS columns_update_admin ON tracker.columns;
CREATE POLICY columns_update_owner
  ON tracker.columns
  FOR UPDATE
  USING (public.is_workspace_owner(workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_id));

-- Service role needs INSERT for init_workspace_columns trigger
DROP POLICY IF EXISTS columns_insert_service_role ON tracker.columns;
CREATE POLICY columns_insert_service_role
  ON tracker.columns
  FOR INSERT
  TO service_role
  WITH CHECK (true);
