-- ============================================================
-- onitask · RLS Policies & Security Hardening
-- File:    004_rls_policies_and_security.sql
-- Version: 1.0.0
-- Date:    2026-07-13
-- Master:  onitask_Architecture_Master_.md v0.13.2
--
-- Исправления:
--   1. REVOKE EXECUTE FROM PUBLIC для ensure_edge_fn_url + get_edge_fn_url
--   2. SET search_path = pg_catalog, public для всех SECURITY DEFINER функций
--   3. Базовые RLS политики для пользовательских таблиц
--
-- Порядок важен: сначала безопасность функций, потом RLS.
-- ============================================================

-- SECTION 1: Безопасность SECURITY DEFINER функций

-- Drop и recreate ensure_edge_fn_url (была создана с другим return type в миграции 003)
DROP FUNCTION IF EXISTS public.ensure_edge_fn_url();

-- REVOKE EXECUTE FOR PUBLIC на оставшихся функциях
REVOKE EXECUTE ON FUNCTION public.get_edge_fn_url() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_edge_fn_url() TO authenticated;

-- 1b. Фиксация search_path для ВСЕХ SECURITY DEFINER функций
-- Это предотвращает SQL injection через malicious schema в search_path

-- ensure_edge_fn_url() — placeholder, фиксируем search_path
CREATE OR REPLACE FUNCTION public.ensure_edge_fn_url()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NULL;
END;
$$;

-- get_edge_fn_url() — возвращает URL Edge Functions
CREATE OR REPLACE FUNCTION public.get_edge_fn_url()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN COALESCE(
    nullif(current_setting('app.edge_fn_url', true), ''),
    'https://atarmvtzvlwhkheeabeb.supabase.co/functions/v1'
  );
END;
$$;

-- get_my_workspace_ids() — возвращает workspace_id текущего пользователя
CREATE OR REPLACE FUNCTION public.get_my_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE PARALLEL SAFE
AS $_$
  SELECT ws.workspace_id
  FROM public.workers ws
  JOIN public.profiles p ON p.id = auth.uid()
  WHERE ws.source_id = p.id::text
    AND ws.is_active = true;
$_$;

-- is_workspace_admin(uuid) — проверяет роль owner/admin
CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE PARALLEL SAFE
AS $_$
  SELECT EXISTS (
    SELECT 1
    FROM public.workers
    WHERE workspace_id = p_workspace_id
      AND role IN ('owner', 'admin')
      AND source_id::text = (SELECT auth.uid()::text)
  );
$_$;

-- SECTION 2: RLS Policies — Пользовательские таблицы

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_can_view_own_profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_can_update_own_profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users_can_insert_own_profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- workspaces
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_workspaces" ON public.workspaces FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers WHERE workers.workspace_id = workspaces.id AND workers.is_active = true AND workers.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_update_own_workspaces" ON public.workspaces FOR UPDATE USING (EXISTS (SELECT 1 FROM public.workers WHERE workers.workspace_id = workspaces.id AND workers.role IN ('owner', 'admin') AND workers.is_active = true AND workers.source_id::text = auth.uid()::text));

-- workers
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_team_workers" ON public.workers FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w2 WHERE w2.workspace_id = workers.workspace_id AND w2.is_active = true AND w2.source_id::text = auth.uid()::text));
CREATE POLICY "admins_can_manage_workers" ON public.workers FOR ALL USING (EXISTS (SELECT 1 FROM public.workers w2 WHERE w2.workspace_id = workers.workspace_id AND w2.role IN ('owner', 'admin') AND w2.is_active = true AND w2.source_id::text = auth.uid()::text)) WITH CHECK (EXISTS (SELECT 1 FROM public.workers w2 WHERE w2.workspace_id = workers.workspace_id AND w2.role IN ('owner', 'admin') AND w2.is_active = true AND w2.source_id::text = auth.uid()::text));

-- tasks
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_tasks" ON public.tasks FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = tasks.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_insert_tasks" ON public.tasks FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = tasks.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_update_own_tasks" ON public.tasks FOR UPDATE USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = tasks.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_delete_tasks" ON public.tasks FOR DELETE USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = tasks.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- columns (tracker schema)
ALTER TABLE tracker.columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_columns" ON tracker.columns FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = columns.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "admins_can_manage_columns" ON tracker.columns FOR ALL USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = columns.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text)) WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = columns.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- sprints
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_sprints" ON public.sprints FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = sprints.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_manage_sprints" ON public.sprints FOR ALL USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = sprints.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text)) WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = sprints.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- invite_links
ALTER TABLE public.invite_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_invite_links" ON public.invite_links FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = invite_links.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "admins_can_manage_invite_links" ON public.invite_links FOR ALL USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = invite_links.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text)) WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = invite_links.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- task_column_history
ALTER TABLE public.task_column_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_task_column_history" ON public.task_column_history FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w JOIN public.tasks t ON t.workspace_id = w.workspace_id WHERE t.id = task_column_history.task_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- workspace_settings
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_workspace_settings" ON public.workspace_settings FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_settings.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "owners_can_update_workspace_settings" ON public.workspace_settings FOR UPDATE USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_settings.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- workspace_telegram_chats
ALTER TABLE public.workspace_telegram_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_telegram_chats" ON public.workspace_telegram_chats FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_telegram_chats.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "admins_can_manage_telegram_chats" ON public.workspace_telegram_chats FOR ALL USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_telegram_chats.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text)) WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_telegram_chats.workspace_id AND w.role IN ('owner', 'admin') AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- СЛУЖЕБНЫЕ ТАБЛИЦЫ — только service role
ALTER TABLE public.enrichment_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_enrichment_queue" ON public.enrichment_queue FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_agent_events" ON public.agent_events FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_agent_memory" ON public.agent_memory FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');

ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_task_events" ON public.task_events FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');

ALTER TABLE public.consolidation_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_consolidation_errors" ON public.consolidation_errors FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');

ALTER TABLE public.task_enrichments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_task_enrichments" ON public.task_enrichments FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- assignment_history — members can view
ALTER TABLE public.assignment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_assignment_history" ON public.assignment_history FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w JOIN public.tasks t ON t.workspace_id = w.workspace_id WHERE t.id = assignment_history.task_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- task_relations — members can view/create
ALTER TABLE public.task_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_task_relations" ON public.task_relations FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w JOIN public.tasks t ON t.workspace_id = w.workspace_id WHERE t.id = task_relations.from_task_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_create_task_relations" ON public.task_relations FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = task_relations.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- workspace_documents — members can view/upload
ALTER TABLE public.workspace_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_documents" ON public.workspace_documents FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_documents.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));
CREATE POLICY "members_can_upload_documents" ON public.workspace_documents FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.workers w WHERE w.workspace_id = workspace_documents.workspace_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- workspace_doc_chunks — members can view
ALTER TABLE public.workspace_doc_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_can_view_doc_chunks" ON public.workspace_doc_chunks FOR SELECT USING (EXISTS (SELECT 1 FROM public.workers w JOIN public.workspace_documents d ON d.workspace_id = w.workspace_id WHERE d.id = workspace_doc_chunks.document_id AND w.is_active = true AND w.source_id::text = auth.uid()::text));

-- workspace_task_counters — service role only
ALTER TABLE public.workspace_task_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_task_counters" ON public.workspace_task_counters FOR ALL USING (auth.jwt()->>'role' = 'service_role') WITH CHECK (auth.jwt()->>'role' = 'service_role');