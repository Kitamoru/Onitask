-- ============================================================
-- onitask · RLS Policies Migration
-- File:    002_rls.sql
-- Version: 1.0.0
-- Date:    июнь 2026
-- Master:  onitask_Architecture_Master_.md v0.13.2
--
-- Запускать ПОСЛЕ 001_init.sql
--
-- Модель безопасности:
--   · Route Handlers → SUPABASE_SERVICE_ROLE_KEY → bypass RLS
--     (основной путь для всех мутаций)
--   · Realtime subscriptions / прямые запросы из TWA → JWT → RLS
--     (защитная сетка; пользователь видит только свои данные)
--   · MCP-агенты → Bearer token + service role → bypass RLS
--     (tenant isolation на уровне Middleware, не RLS)
--
-- Соответствие принятым решениям:
--   Q4: Агенты обходят RLS через service role
--   Q5: TWA-пользователи аутентифицированы через Supabase Auth JWT
--   Q6: tasks → SELECT по workspace участника
--       workspace_settings → SELECT всем, UPDATE только owner/admin
--   Q7: agent_events → READ для участников workspace (Task Sheet)
-- ============================================================

-- ============================================================
-- SECTION 1: Helper Functions
-- ============================================================

-- Возвращает все workspace_id, где текущий JWT-пользователь активен.
-- SECURITY DEFINER: выполняется с правами создателя функции.
-- Используется во всех USING-клаузах политик.
CREATE OR REPLACE FUNCTION public.get_my_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT workspace_id
  FROM public.workers
  WHERE source_id = auth.uid()::text
    AND is_active  = true;
$$;

-- Проверяет, является ли текущий пользователь owner или admin в указанном workspace.
CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workers
    WHERE workspace_id = p_workspace_id
      AND source_id    = auth.uid()::text
      AND role         IN ('owner', 'admin')
      AND is_active    = true
  );
$$;

-- ============================================================
-- SECTION 2: Enable RLS на всех таблицах
-- ============================================================

-- public schema
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_counters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_links             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_column_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_enrichments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_telegram_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consolidation_errors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_doc_chunks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_relations           ENABLE ROW LEVEL SECURITY;

-- tracker schema
ALTER TABLE tracker.columns ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 3: Таблицы только для service role
-- (RLS включён, политики не создаются → доступ только через service role)
-- ============================================================

-- workspace_task_counters: атомарные счётчики, только Route Handler
-- enrichment_queue:        внутренняя очередь Cold Path
-- agent_memory:            LTM-хранилище, только Edge Functions
-- consolidation_errors:    операционный лог, только Edge Functions
-- assignment_history:      аналитический датасет Контура 2 (INV-12)

-- Комментарий: отсутствие политик при включённом RLS блокирует
-- все прямые запросы от анонимных и JWT-пользователей.
-- Service role (SUPABASE_SERVICE_ROLE_KEY) обходит RLS всегда.

-- ============================================================
-- SECTION 4: profiles
-- ============================================================

-- Пользователь видит только свой профиль
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

-- Пользователь может обновить только свой профиль
-- (display_name, avatar_url — только через явные настройки в TWA, не при /api/init)
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT выполняется только через service role (/api/init)

-- ============================================================
-- SECTION 5: workspaces
-- ============================================================

-- Участник видит только свои workspace
CREATE POLICY workspaces_select_member
  ON public.workspaces
  FOR SELECT
  USING (id IN (SELECT public.get_my_workspace_ids()));

-- UPDATE только owner/admin (slug, name, plan)
CREATE POLICY workspaces_update_admin
  ON public.workspaces
  FOR UPDATE
  USING (public.is_workspace_admin(id))
  WITH CHECK (public.is_workspace_admin(id));

-- INSERT выполняется только через service role (POST /api/workspaces транзакция)

-- ============================================================
-- SECTION 6: workers
-- ============================================================

-- Участник видит всех workers своего workspace (нужно для списка исполнителей)
CREATE POLICY workers_select_member
  ON public.workers
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Участник может обновить только свою запись (display_name, avatar_url)
-- Смена role выполняется только через service role (admin action)
CREATE POLICY workers_update_own
  ON public.workers
  FOR UPDATE
  USING (source_id = auth.uid()::text)
  WITH CHECK (
    source_id = auth.uid()::text
    -- Запрещаем самостоятельную смену role: должна остаться прежней
    AND role = (SELECT role FROM public.workers WHERE id = workers.id)
  );

-- INSERT выполняется только через service role
-- (создание при invite acceptance, workspace creation, auto_create_agent_worker)

-- ============================================================
-- SECTION 7: workspace_settings
-- ============================================================

-- Все участники видят настройки своего workspace (нужно для F-01, F-03, F-04)
CREATE POLICY workspace_settings_select_member
  ON public.workspace_settings
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Обновление только owner/admin (Q6)
CREATE POLICY workspace_settings_update_admin
  ON public.workspace_settings
  FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- INSERT выполняется только через service role (POST /api/workspaces транзакция)

-- ============================================================
-- SECTION 8: tracker.columns
-- ============================================================

-- Участники видят конфигурацию колонок (WIP-лимиты, цвета)
CREATE POLICY columns_select_member
  ON tracker.columns
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Обновление WIP-лимитов только owner/admin
CREATE POLICY columns_update_admin
  ON tracker.columns
  FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- INSERT выполняется только через service role (trg_init_workspace_columns)

-- ============================================================
-- SECTION 9: sprints
-- ============================================================

-- Все участники видят спринты
CREATE POLICY sprints_select_member
  ON public.sprints
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Создание/изменение спринтов только owner/admin
CREATE POLICY sprints_insert_admin
  ON public.sprints
  FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY sprints_update_admin
  ON public.sprints
  FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- ============================================================
-- SECTION 10: tasks
-- ============================================================

-- Участник видит все задачи своего workspace (Q6)
CREATE POLICY tasks_select_member
  ON public.tasks
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Любой участник может создать задачу в своём workspace
CREATE POLICY tasks_insert_member
  ON public.tasks
  FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Участник может обновить задачи своего workspace
-- Last-write-wins для TWA (Q14); version-check только в MCP (через service role)
CREATE POLICY tasks_update_member
  ON public.tasks
  FOR UPDATE
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Удаление только owner/admin
CREATE POLICY tasks_delete_admin
  ON public.tasks
  FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- SECTION 11: invite_links
-- ============================================================

-- Участники видят инвайты своего workspace
CREATE POLICY invite_links_select_member
  ON public.invite_links
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Создание инвайтов только owner/admin
CREATE POLICY invite_links_insert_admin
  ON public.invite_links
  FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- Деактивация инвайтов только owner/admin (is_active = false)
CREATE POLICY invite_links_update_admin
  ON public.invite_links
  FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- ============================================================
-- SECTION 12: task_column_history
-- ============================================================

-- Участники видят историю перемещений (для Task Sheet, метрик velocity)
CREATE POLICY task_column_history_select_member
  ON public.task_column_history
  FOR SELECT
  USING (
    task_id IN (
      SELECT id FROM public.tasks
      WHERE workspace_id IN (SELECT public.get_my_workspace_ids())
    )
  );

-- INSERT выполняется только через service role (trg_record_task_column_move)

-- ============================================================
-- SECTION 13: task_enrichments
-- ============================================================

-- Участники видят обогащения (ai_hint, story_points в карточках задач)
CREATE POLICY task_enrichments_select_member
  ON public.task_enrichments
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- INSERT/UPDATE выполняются только через service role (F-03 Edge Function)

-- ============================================================
-- SECTION 14: agent_events
-- ============================================================

-- Участники видят историю действий агентов (Task Sheet, Team Tab) (Q7)
CREATE POLICY agent_events_select_member
  ON public.agent_events
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- INSERT выполняется только через service role (MCP Route Handlers)

-- ============================================================
-- SECTION 15: workspace_telegram_chats
-- ============================================================

-- Участники видят подключённые чаты workspace
CREATE POLICY workspace_telegram_chats_select_member
  ON public.workspace_telegram_chats
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Подключение/управление чатами только owner/admin
CREATE POLICY workspace_telegram_chats_insert_admin
  ON public.workspace_telegram_chats
  FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY workspace_telegram_chats_update_admin
  ON public.workspace_telegram_chats
  FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- ============================================================
-- SECTION 16: task_events
-- ============================================================

-- Участники видят все события задач (комментарии, history в Task Sheet)
CREATE POLICY task_events_select_member
  ON public.task_events
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Участники могут добавлять ТОЛЬКО комментарии напрямую
-- Остальные типы (enrichment, parse_rewrite, etc.) — только через service role
CREATE POLICY task_events_insert_comment
  ON public.task_events
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT public.get_my_workspace_ids())
    AND event_type = 'comment'
  );

-- ============================================================
-- SECTION 17: workspace_documents
-- ============================================================

-- Участники видят документы knowledge base своего workspace
CREATE POLICY workspace_documents_select_member
  ON public.workspace_documents
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Загрузка документов доступна всем участникам
CREATE POLICY workspace_documents_insert_member
  ON public.workspace_documents
  FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Удаление документов только owner/admin
CREATE POLICY workspace_documents_delete_admin
  ON public.workspace_documents
  FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- SECTION 18: workspace_doc_chunks
-- ============================================================

-- Участники видят чанки (нужно для Doc RAG в UI)
CREATE POLICY workspace_doc_chunks_select_member
  ON public.workspace_doc_chunks
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- INSERT выполняется только через service role (doc_process Edge Function)

-- ============================================================
-- SECTION 19: task_relations
-- ============================================================

-- Участники видят все зависимости задач (Blocker Chain в Task Sheet)
CREATE POLICY task_relations_select_member
  ON public.task_relations
  FOR SELECT
  USING (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Участники могут создавать связи между задачами через UI
-- (POST /api/tasks/:id/relations — Route Handler проверяет workspace ownership)
CREATE POLICY task_relations_insert_member
  ON public.task_relations
  FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_my_workspace_ids()));

-- Удалять связи могут только owner/admin
-- (снятие блокировок критично — рядовой участник не должен менять граф)
CREATE POLICY task_relations_delete_admin
  ON public.task_relations
  FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- END OF 002_rls.sql
-- ============================================================
--
-- Проверка после применения:
--
-- 1. Убедиться что анонимный SELECT на tasks возвращает 0 строк:
--    SELECT COUNT(*) FROM public.tasks; -- должно вернуть 0 для anon role
--
-- 2. Убедиться что участник видит только свои workspace:
--    SET LOCAL role TO authenticated;
--    SET LOCAL request.jwt.claims TO '{"sub": "<user-uuid>"}';
--    SELECT id FROM public.workspaces; -- только workspace участника
--
-- 3. Убедиться что service role видит всё:
--    -- Через SUPABASE_SERVICE_ROLE_KEY обходит RLS полностью
-- ============================================================
