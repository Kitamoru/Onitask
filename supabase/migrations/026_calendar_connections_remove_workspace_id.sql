-- Migration: calendar_connections — remove workspace_id column
-- Calendar connections are per-worker, not per-workspace
-- workspace_id resolved at runtime from workers table
-- Master Spec §6.19, onitask_calendar_.md §4

-- ═══════════════════════════════════════════════════════
-- 1. Drop existing policies before altering table
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS calendar_connections_select_policy ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_connections_insert_policy ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_connections_update_policy ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_connections_delete_policy ON public.calendar_connections;

-- ═══════════════════════════════════════════════════════
-- 2. Remove unique constraint that references workspace_id
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.calendar_connections 
  DROP CONSTRAINT IF EXISTS uq_calendar_connections;

-- ═══════════════════════════════════════════════════════
-- 3. Drop workspace_id column
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.calendar_connections 
  DROP COLUMN IF EXISTS workspace_id;

-- ═══════════════════════════════════════════════════════
-- 4. Add new unique constraint (worker + provider)
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.calendar_connections
  ADD CONSTRAINT uq_calendar_connections_worker_provider UNIQUE (worker_id, provider);

-- ═══════════════════════════════════════════════════════
-- 5. Update RLS policies (use worker_id → workers.workspace_id via join)
-- ═══════════════════════════════════════════════════════

-- Helper function: get workspace_ids for current auth user's workers
CREATE OR REPLACE FUNCTION public.current_worker_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT DISTINCT workspace_id FROM public.workers WHERE source_id = auth.uid()::text;
$$ LANGUAGE sql STABLE;

-- Helper function: get workspace_id for a specific worker_id
CREATE OR REPLACE FUNCTION public.worker_workspace_id(p_worker_id uuid)
RETURNS uuid AS $$
  SELECT workspace_id FROM public.workers WHERE id = p_worker_id LIMIT 1;
$$ LANGUAGE sql STABLE;

-- calendar_connections policies (now based on worker_id)
CREATE POLICY calendar_connections_select_policy ON public.calendar_connections
  FOR SELECT USING (
    worker_id IN (
      SELECT w.id FROM public.workers w 
      WHERE w.source_id = auth.uid()::text
    )
  );

CREATE POLICY calendar_connections_insert_policy ON public.calendar_connections
  FOR INSERT WITH CHECK (
    worker_id IN (
      SELECT w.id FROM public.workers w 
      WHERE w.source_id = auth.uid()::text
    )
  );

CREATE POLICY calendar_connections_update_policy ON public.calendar_connections
  FOR UPDATE USING (
    worker_id IN (
      SELECT w.id FROM public.workers w 
      WHERE w.source_id = auth.uid()::text
    )
  );

CREATE POLICY calendar_connections_delete_policy ON public.calendar_connections
  FOR DELETE USING (
    worker_id IN (
      SELECT w.id FROM public.workers w 
      WHERE w.source_id = auth.uid()::text
    )
  );

-- ═══════════════════════════════════════════════════════
-- 6. Update comment
-- ═══════════════════════════════════════════════════════

COMMENT ON TABLE public.calendar_connections IS
  'Подключённые внешние календари (Yandex CalDAV, Outlook Graph API). Per-worker connection. Токены зашифрованы AES-256-GCM (INV-17). workspace_id определяется через workers.workspace_id.';