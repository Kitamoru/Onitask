-- ============================================================
-- onitask · Migration 010
-- File:    010_workspaces_insert_policy.sql
-- Date:    2026-07-20
--
-- Problem: POST /api/workspaces returns 403 because there is no
--          INSERT policy for public.workspaces in RLS.
-- Fix:     Add authenticated_can_create_workspaces policy.
-- ============================================================

-- Add INSERT policy for workspaces so authenticated users can create workspaces
CREATE POLICY "authenticated_can_create_workspaces"
  ON public.workspaces
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);