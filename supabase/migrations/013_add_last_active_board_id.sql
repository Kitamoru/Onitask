-- ============================================================
-- onitask · Add last_active_board_id to workspace_settings
-- File:    013_add_last_active_board_id.sql
-- Purpose: Remember the last active board per user for session persistence
-- Date:    2026-07-27
-- ============================================================

-- STEP 1: Add last_active_board_id column to workspace_settings
-- This stores the UUID of the most recently selected board per profile
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS last_active_board_id uuid REFERENCES public.workspaces(id);

-- STEP 2: Index for faster lookups when restoring active board
CREATE INDEX IF NOT EXISTS idx_workspace_settings_last_active_board
  ON public.workspace_settings (last_active_board_id)
  WHERE last_active_board_id IS NOT NULL;