-- ============================================================================
-- Migration: 008_optimize_performance.sql
-- Purpose: Database performance optimization — indexes, RLS fixes, cleanup
-- Date: 2026-07-16
-- ============================================================================

-- ============================================================================
-- PART 1: Fix unindexed foreign keys (CRITICAL for JOIN performance)
-- ============================================================================

-- agent_memory.task_id → tasks(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_memory_task_id
  ON public.agent_memory (task_id);

-- agent_memory.workspace_id → workspaces(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_memory_workspace_id
  ON public.agent_memory (workspace_id);

-- assignment_history.assigned_by → workers(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_history_assigned_by
  ON public.assignment_history (assigned_by);

-- invite_links.created_by → workers(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invite_links_created_by
  ON public.invite_links (created_by);

-- task_enrichments.workspace_id → workspaces(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_enrichments_workspace_id
  ON public.task_enrichments (workspace_id);

-- task_events.workspace_id → workspaces(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_events_workspace_id
  ON public.task_events (workspace_id);

-- task_relations.created_by → workers(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_relations_created_by
  ON public.task_relations (created_by);

-- tasks.handoff_to → workers(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_handoff_to
  ON public.tasks (handoff_to);

-- tasks.sprint_id → sprints(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_sprint_id
  ON public.tasks (sprint_id);

-- workspace_doc_chunks.document_id → workspace_documents(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doc_chunks_document_id
  ON public.workspace_doc_chunks (document_id);

-- workspace_documents.uploaded_by → workers(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_documents_uploaded_by
  ON public.workspace_documents (uploaded_by);

-- workspace_documents.workspace_id → workspaces(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_documents_workspace_id
  ON public.workspace_documents (workspace_id);

-- workspace_links.created_by → workers(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_links_created_by
  ON public.workspace_links (created_by);

-- workspace_telegram_chats.linked_by → profiles(id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_telegram_chats_linked_by
  ON public.workspace_telegram_chats (linked_by);

-- ============================================================================
-- PART 2: Remove duplicate / redundant indexes
-- ============================================================================

-- idx_invite_links_workspace_active is a duplicate of idx_invite_links_workspace
-- (both index workspace_id with the same WHERE clause)
DROP INDEX IF EXISTS public.idx_invite_links_workspace_active;

-- ============================================================================
-- PART 3: Enable RLS on workspace_links (CRITICAL security fix)
-- ============================================================================

ALTER TABLE public.workspace_links ENABLE ROW LEVEL SECURITY;

-- RLS policy: members can view workspace links
CREATE POLICY "members_can_view_workspace_links"
  ON public.workspace_links FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE id = (SELECT auth.uid()) AND is_active = true
    )
  );

-- RLS policy: admins can manage workspace links
CREATE POLICY "admins_can_manage_workspace_links"
  ON public.workspace_links FOR ALL
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE id = (SELECT auth.uid())
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE id = (SELECT auth.uid())
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ============================================================================
-- PART 4: Optimize RLS policies — replace auth.uid() with subselect pattern
-- ============================================================================
-- This reduces per-row evaluation overhead for RLS checks.
-- Strategy: Drop ALL permissive policies per table, then recreate with
--            (select auth.uid()) subselect pattern. This eliminates both
--            auth_rls_initplan warnings AND multiple_permissive_policies warnings.

-- Helper CTE to get current user's workspace IDs once per query
-- Each policy uses this pattern: (select auth.uid())

-- ===================== profiles =====================
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS users_can_view_own_profile ON public.profiles;
DROP POLICY IF EXISTS users_can_update_own_profile ON public.profiles;
DROP POLICY IF EXISTS users_can_insert_own_profile ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "users_can_insert_own_profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- ===================== workers =====================
DROP POLICY IF EXISTS workers_update_own ON public.workers;
DROP POLICY IF EXISTS members_can_view_team_workers ON public.workers;
DROP POLICY IF EXISTS admins_can_manage_workers ON public.workers;
DROP POLICY IF EXISTS workers_select_member ON public.workers;

CREATE POLICY "workers_update_own" ON public.workers
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "members_can_view_team_workers" ON public.workers
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "admins_can_manage_workers" ON public.workers
  FOR ALL TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ===================== tasks =====================
DROP POLICY IF EXISTS members_can_view_tasks ON public.tasks;
DROP POLICY IF EXISTS members_can_insert_tasks ON public.tasks;
DROP POLICY IF EXISTS members_can_update_own_tasks ON public.tasks;
DROP POLICY IF EXISTS members_can_delete_tasks ON public.tasks;
DROP POLICY IF EXISTS tasks_select_member ON public.tasks;
DROP POLICY IF EXISTS tasks_insert_member ON public.tasks;
DROP POLICY IF EXISTS tasks_update_member ON public.tasks;
DROP POLICY IF EXISTS tasks_delete_admin ON public.tasks;

CREATE POLICY "members_can_view_tasks" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_insert_tasks" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_update_own_tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_delete_tasks" ON public.tasks
  FOR DELETE TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

-- ===================== workspaces =====================
DROP POLICY IF EXISTS members_can_view_workspaces ON public.workspaces;
DROP POLICY IF EXISTS members_can_update_own_workspaces ON public.workspaces;
DROP POLICY IF EXISTS workspaces_select_member ON public.workspaces;
DROP POLICY IF EXISTS workspaces_update_admin ON public.workspaces;

CREATE POLICY "members_can_view_workspaces" ON public.workspaces
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_update_own_workspaces" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND role IN ('owner', 'admin') AND is_active = true
    )
  )
  WITH CHECK (
    id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND role IN ('owner', 'admin') AND is_active = true
    )
  );

-- ===================== sprints =====================
DROP POLICY IF EXISTS members_can_view_sprints ON public.sprints;
DROP POLICY IF EXISTS members_can_manage_sprints ON public.sprints;
DROP POLICY IF EXISTS sprints_select_member ON public.sprints;
DROP POLICY IF EXISTS sprints_insert_admin ON public.sprints;
DROP POLICY IF EXISTS sprints_update_admin ON public.sprints;

CREATE POLICY "members_can_view_sprints" ON public.sprints
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_manage_sprints" ON public.sprints
  FOR ALL TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ===================== invite_links =====================
DROP POLICY IF EXISTS members_can_view_invite_links ON public.invite_links;
DROP POLICY IF EXISTS admins_can_manage_invite_links ON public.invite_links;
DROP POLICY IF EXISTS invite_links_insert_admin ON public.invite_links;
DROP POLICY IF EXISTS invite_links_select_member ON public.invite_links;
DROP POLICY IF EXISTS invite_links_update_admin ON public.invite_links;

CREATE POLICY "members_can_view_invite_links" ON public.invite_links
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "admins_can_manage_invite_links" ON public.invite_links
  FOR ALL TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ===================== task_column_history =====================
DROP POLICY IF EXISTS members_can_view_task_column_history ON public.task_column_history;
DROP POLICY IF EXISTS task_column_history_select_member ON public.task_column_history;

CREATE POLICY "members_can_view_task_column_history" ON public.task_column_history
  FOR SELECT TO authenticated
  USING (
    task_id IN (
      SELECT id FROM public.tasks
      WHERE workspace_id IN (
        SELECT workspace_id FROM public.workers
        WHERE (select auth.uid()) = id AND is_active = true
      )
    )
  );

-- ===================== workspace_settings =====================
DROP POLICY IF EXISTS members_can_view_workspace_settings ON public.workspace_settings;
DROP POLICY IF EXISTS owners_can_update_workspace_settings ON public.workspace_settings;
DROP POLICY IF EXISTS workspace_settings_select_member ON public.workspace_settings;
DROP POLICY IF EXISTS workspace_settings_update_admin ON public.workspace_settings;

CREATE POLICY "members_can_view_workspace_settings" ON public.workspace_settings
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "owners_can_update_workspace_settings" ON public.workspace_settings
  FOR UPDATE TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ===================== workspace_telegram_chats =====================
DROP POLICY IF EXISTS members_can_view_telegram_chats ON public.workspace_telegram_chats;
DROP POLICY IF EXISTS admins_can_manage_telegram_chats ON public.workspace_telegram_chats;
DROP POLICY IF EXISTS workspace_telegram_chats_insert_admin ON public.workspace_telegram_chats;
DROP POLICY IF EXISTS workspace_telegram_chats_select_member ON public.workspace_telegram_chats;
DROP POLICY IF EXISTS workspace_telegram_chats_update_admin ON public.workspace_telegram_chats;

CREATE POLICY "members_can_view_telegram_chats" ON public.workspace_telegram_chats
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "admins_can_manage_telegram_chats" ON public.workspace_telegram_chats
  FOR ALL TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ===================== enrichment_queue (service_role only) =====================
DROP POLICY IF EXISTS service_role_only_enrichment_queue ON public.enrichment_queue;

CREATE POLICY "service_role_only_enrichment_queue" ON public.enrichment_queue
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== agent_events =====================
DROP POLICY IF EXISTS service_role_only_agent_events ON public.agent_events;
DROP POLICY IF EXISTS agent_events_select_member ON public.agent_events;

CREATE POLICY "service_role_only_agent_events" ON public.agent_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== agent_memory (service_role only) =====================
DROP POLICY IF EXISTS service_role_only_agent_memory ON public.agent_memory;

CREATE POLICY "service_role_only_agent_memory" ON public.agent_memory
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== task_events =====================
DROP POLICY IF EXISTS service_role_only_task_events ON public.task_events;
DROP POLICY IF EXISTS task_events_insert_comment ON public.task_events;
DROP POLICY IF EXISTS task_events_select_member ON public.task_events;

CREATE POLICY "service_role_only_task_events" ON public.task_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== consolidation_errors (service_role only) =====================
DROP POLICY IF EXISTS service_role_only_consolidation_errors ON public.consolidation_errors;

CREATE POLICY "service_role_only_consolidation_errors" ON public.consolidation_errors
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== task_enrichments =====================
DROP POLICY IF EXISTS service_role_only_task_enrichments ON public.task_enrichments;
DROP POLICY IF EXISTS task_enrichments_select_member ON public.task_enrichments;

CREATE POLICY "service_role_only_task_enrichments" ON public.task_enrichments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== workspace_documents =====================
DROP POLICY IF EXISTS members_can_view_documents ON public.workspace_documents;
DROP POLICY IF EXISTS members_can_upload_documents ON public.workspace_documents;
DROP POLICY IF EXISTS workspace_documents_insert_member ON public.workspace_documents;
DROP POLICY IF EXISTS workspace_documents_select_member ON public.workspace_documents;
DROP POLICY IF EXISTS workspace_documents_delete_admin ON public.workspace_documents;

CREATE POLICY "members_can_view_documents" ON public.workspace_documents
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_upload_documents" ON public.workspace_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

-- ===================== workspace_doc_chunks =====================
DROP POLICY IF EXISTS members_can_view_doc_chunks ON public.workspace_doc_chunks;
DROP POLICY IF EXISTS workspace_doc_chunks_select_member ON public.workspace_doc_chunks;

CREATE POLICY "members_can_view_doc_chunks" ON public.workspace_doc_chunks
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

-- ===================== workspace_task_counters (service_role only) =====================
DROP POLICY IF EXISTS service_role_only_task_counters ON public.workspace_task_counters;

CREATE POLICY "service_role_only_task_counters" ON public.workspace_task_counters
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================== task_relations =====================
DROP POLICY IF EXISTS members_can_view_task_relations ON public.task_relations;
DROP POLICY IF EXISTS members_can_create_task_relations ON public.task_relations;
DROP POLICY IF EXISTS task_relations_insert_member ON public.task_relations;
DROP POLICY IF EXISTS task_relations_select_member ON public.task_relations;
DROP POLICY IF EXISTS task_relations_delete_admin ON public.task_relations;

CREATE POLICY "members_can_view_task_relations" ON public.task_relations
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "members_can_create_task_relations" ON public.task_relations
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

-- ===================== assignment_history =====================
DROP POLICY IF EXISTS members_can_view_assignment_history ON public.assignment_history;

CREATE POLICY "members_can_view_assignment_history" ON public.assignment_history
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

-- ===================== tracker.columns =====================
DROP POLICY IF EXISTS members_can_view_columns ON tracker.columns;
DROP POLICY IF EXISTS admins_can_manage_columns ON tracker.columns;
DROP POLICY IF EXISTS columns_select_member ON tracker.columns;
DROP POLICY IF EXISTS columns_update_admin ON tracker.columns;

CREATE POLICY "members_can_view_columns" ON tracker.columns
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id AND is_active = true
    )
  );

CREATE POLICY "admins_can_manage_columns" ON tracker.columns
  FOR ALL TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workers
      WHERE (select auth.uid()) = id
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );

-- ============================================================================
-- PART 5: Add composite indexes for common query patterns
-- ============================================================================

-- Tasks: filter by workspace + column + priority (board view)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_workspace_column_priority
  ON public.tasks (workspace_id, "column", priority);

-- Tasks: filter by workspace + deadline for urgency calculations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_workspace_deadline
  ON public.tasks (workspace_id, deadline) WHERE deadline IS NOT NULL;

-- Assignment history: assignee + workspace for attention-risk queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_history_assignee_workspace
  ON public.assignment_history (assignee_id, workspace_id);

-- Worker lookup by workspace + role for admin checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workers_workspace_role
  ON public.workers (workspace_id, role, is_active);

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================