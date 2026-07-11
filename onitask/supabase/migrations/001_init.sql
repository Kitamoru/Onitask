-- ============================================================
-- onitask · Database Init Migration
-- File:    001_init.sql
-- Version: 1.0.0
-- Date:    июнь 2026
-- Master:  onitask_Architecture_Master_.md v0.13.2
--
-- Полная схема для нового Supabase-проекта (с нуля).
-- Запускать ДО 002_rls.sql
--
-- Предварительные требования:
--   1. В Supabase Dashboard → Extensions включить:
--      pgcrypto, vector, pg_trgm, pg_net, pg_cron
--   2. Перед запуском cron-джобов установить переменные:
--      ALTER DATABASE postgres
--        SET app.edge_fn_url = 'https://<ref>.supabase.co/functions/v1';
--      ALTER DATABASE postgres
--        SET app.service_key = '<service_role_key>';
--
-- Примечания:
--   · "column" — зарезервированное слово PostgreSQL.
--     В DDL пишется как "column" (с кавычками).
--     В запросах с алиасом таблицы (t.column) кавычки не нужны —
--     PostgreSQL корректно разрешает контекст.
--   · priority: 'low' | 'medium' | 'high' | 'critical'
--     MCP contract §4 использует 'normal' вместо 'medium' —
--     требуется отдельное исправление onitask_mcp_contract_.md.
-- ============================================================

-- ============================================================
-- SECTION 0: Расширения и схемы
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE SCHEMA IF NOT EXISTS tracker;

-- ============================================================
-- SECTION 1: Базовые таблицы идентификации
-- ============================================================

-- 1.1 profiles
-- Связывает Supabase Auth (auth.users) с пользовательскими данными onitask.
-- Создаётся через /api/init: find-or-create ТОЛЬКО.
-- display_name и avatar_url устанавливаются при создании из Telegram initData
-- и обновляются ТОЛЬКО через явные настройки профиля в TWA.
-- Автообновление при повторном вызове /api/init запрещено (Q12).
CREATE TABLE public.profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id  bigint      UNIQUE NOT NULL,
  display_name text        NOT NULL DEFAULT '',
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_telegram ON public.profiles (telegram_id);

-- 1.2 workspaces
CREATE TABLE public.workspaces (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  slug        text        UNIQUE NOT NULL,
  plan        text        NOT NULL DEFAULT 'free'
              CHECK (plan IN ('free', 'solo', 'ai_dev', 'team')),
  task_prefix text        CHECK (task_prefix ~ '^[A-Z]{2,6}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- task_prefix иммутабелен после создания (INV-11, trg_prevent_task_prefix_update)
CREATE UNIQUE INDEX idx_workspaces_task_prefix
  ON public.workspaces (task_prefix)
  WHERE task_prefix IS NOT NULL;

-- 1.3 workspace_task_counters
-- Атомарная нумерация задач per-workspace.
-- Создаётся автоматически триггером trg_init_task_counter при INSERT в workspaces.
CREATE TABLE public.workspace_task_counters (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  last_number  int  NOT NULL DEFAULT 0
);

-- 1.4 workers (Master §4)
-- Единая модель исполнителя: человек (type='human') или AI-агент (type='agent').
-- human:  source_id = profiles.id (uuid как text)
-- agent:  source_id = 'agent::<name>'
-- role:   owner/admin/member/viewer для людей; NULL для агентов
CREATE TABLE public.workers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('human', 'agent')),
  role         text        CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  display_name text        NOT NULL,
  source_id    text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_id)
);

CREATE INDEX idx_workers_workspace_id ON public.workers (workspace_id);
CREATE INDEX idx_workers_source_id    ON public.workers (workspace_id, source_id);

-- ============================================================
-- SECTION 2: Конфигурация воркспейса
-- ============================================================

-- 2.1 workspace_settings (Master §6.4)
-- Единственный источник настроек для всех модулей (Master §8).
-- Создаётся Route Handler в транзакции создания workspace (Q15).
CREATE TABLE public.workspace_settings (
  workspace_id                uuid    PRIMARY KEY
                              REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enable_cognitive_budget     boolean NOT NULL DEFAULT true,
  story_points_config         jsonb   NOT NULL DEFAULT '{"enabled": false}',
  velocity_window_days        int     NOT NULL DEFAULT 14,
  flow_config                 jsonb   NOT NULL DEFAULT
                              '{"stuck_threshold_hours": 72, "overload_threshold": 6, "wip_alert_multiplier": 1.5}',
  realtime_subscription_level text    NOT NULL DEFAULT 'own_tasks'
                              CHECK (realtime_subscription_level IN ('own_tasks', 'all')),
  workspace_context           text    CHECK (char_length(workspace_context) <= 800),
  workspace_context_cache     text    CHECK (char_length(workspace_context_cache) <= 500),
  context_stale               boolean NOT NULL DEFAULT false,
  standup_config              jsonb   NOT NULL DEFAULT
                              '{"enabled": false, "time_utc": "07:00", "chat_id": null}',
  doc_kb_config               jsonb   NOT NULL DEFAULT
                              '{"enabled": true, "max_file_bytes": 524288, "max_total_bytes": 5242880, "max_files": 20}',
  f04_config                  jsonb   NOT NULL DEFAULT
                              '{"skip_min_clarity": 0.85, "skip_max_complexity": 1, "correction_sheet_clarity_threshold": 0.70, "low_clarity_tag_threshold": 0.55}',
  quota_config                jsonb   NOT NULL DEFAULT
                              '{"agent_reserved_pct": 60, "human_min_pct": 40}',
  data_sharing_level          text    NOT NULL DEFAULT 'standard'
                              CHECK (data_sharing_level IN ('minimal', 'standard', 'full')),
  mcp_api_keys                jsonb   NOT NULL DEFAULT '{}',
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_settings_flow_config
  ON public.workspace_settings ((flow_config->>'overload_threshold'));

-- 2.2 tracker.columns
-- Конфигурация колонок канбана per-workspace (WIP-лимиты, отображение).
-- FK изменён: project_id → workspace_id (tracker.projects удалён).
-- 4 дефолтные колонки создаются триггером trg_init_workspace_columns.
CREATE TABLE tracker.columns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  system_status text,
  wip_limit     int,
  position      float8      NOT NULL DEFAULT 65536.0,
  color         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_columns_workspace ON tracker.columns (workspace_id);
CREATE INDEX idx_columns_position  ON tracker.columns (workspace_id, position);

-- ============================================================
-- SECTION 3: Спринты и задачи
-- ============================================================

-- 3.1 sprints (Master §6.2)
CREATE TABLE public.sprints (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text,
  start_date   date        NOT NULL,
  end_date     date        NOT NULL,
  capacity     int,
  status       text        NOT NULL DEFAULT 'planning'
               CHECK (status IN ('planning', 'active', 'completed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sprints_workspace_id ON public.sprints (workspace_id);

-- 3.2 tasks (Master §6.1 — полный CREATE для нового проекта)
-- "column" — зарезервированное слово, в DDL в кавычках.
-- В запросах с алиасом (t.column) кавычки не нужны.
-- embedding_hash + embedding_updated_at: кэш эмбеддингов (Master v0.13.2).
CREATE TABLE public.tasks (
  -- Идентификация
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_number          int,
  -- Содержание
  title                text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description          text,
  tags                 text[]      NOT NULL DEFAULT '{}',
  -- Колонка и приоритет
  "column"             text        NOT NULL DEFAULT 'backlog'
                       CHECK ("column" IN ('backlog', 'in_progress', 'review', 'done')),
  priority             text        NOT NULL DEFAULT 'medium'
                       CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  deadline             timestamptz,
  deadline_urgency     text        CHECK (deadline_urgency IN ('critical', 'normal')),
  -- Флаги
  is_inbox             boolean     NOT NULL DEFAULT false,
  is_blocked           boolean     NOT NULL DEFAULT false,
  needs_human          boolean     NOT NULL DEFAULT false,
  escalation_reason    text        CHECK (escalation_reason IN (
                         'insufficient_context', 'conflicting_requirements',
                         'blocked_by', 'out_of_scope'
                       )),
  -- Исполнители (все → public.workers)
  assigned_to          uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  reviewer_id          uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  handoff_to           uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  handoff_notes        text        CHECK (char_length(handoff_notes) <= 1000),
  -- Спринт
  sprint_id            uuid        REFERENCES public.sprints(id) ON DELETE SET NULL,
  -- AI и обогащение
  cognitive_weight     int         NOT NULL DEFAULT 1
                       CHECK (cognitive_weight IN (0, 1, 2, 3)),
  raw_input            text,
  clarity_score        float       CHECK (clarity_score BETWEEN 0.0 AND 1.0),
  complexity           smallint    CHECK (complexity BETWEEN 1 AND 3),
  enrichment_strategy  text        CHECK (enrichment_strategy IN ('skip', 'light', 'standard')),
  -- Эмбеддинг с кэшированием (Master v0.13.2)
  embedding            vector(1024),
  embedding_hash       text,
  embedding_updated_at timestamptz,
  -- Системные поля
  version              int         NOT NULL DEFAULT 0,
  moved_to_column_at   timestamptz,
  position             float8      NOT NULL DEFAULT 65536.0,
  source               text        CHECK (source IN ('nl', 'voice', 'manual', 'mcp', 'bot')),
  metadata             jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Нумерация уникальна в рамках workspace
CREATE UNIQUE INDEX idx_tasks_task_number
  ON public.tasks (workspace_id, task_number);
CREATE INDEX idx_tasks_workspace_id
  ON public.tasks (workspace_id);
-- Для overloaded_workers и поиска по исполнителю
CREATE INDEX idx_tasks_assigned_to_column
  ON public.tasks (assigned_to, "column")
  WHERE is_blocked = false;
-- Для stuck_tasks VIEW
CREATE INDEX idx_tasks_column_moved_at
  ON public.tasks ("column", moved_to_column_at)
  WHERE "column" != 'done';
-- Для pending_escalations VIEW
CREATE INDEX idx_tasks_needs_human
  ON public.tasks (needs_human, "column")
  WHERE needs_human = true AND "column" != 'done';
-- Для review_backlog VIEW
CREATE INDEX idx_tasks_reviewer_column
  ON public.tasks (reviewer_id, "column")
  WHERE "column" = 'review';
-- Для семантического поиска match_tasks() (A-4)
CREATE INDEX idx_tasks_embedding
  ON public.tasks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
-- Для duplicate_tasks VIEW (pg_trgm)
CREATE INDEX idx_tasks_title_trgm
  ON public.tasks USING gin(title gin_trgm_ops)
  WHERE "column" != 'done';
-- Для cascade_unblock JOIN (sql_anomalies_.md §8)
CREATE INDEX idx_tasks_id_column
  ON public.tasks (id, "column");

-- ============================================================
-- SECTION 4: Вспомогательные таблицы
-- ============================================================

-- 4.1 invite_links
-- Один активный инвайт на workspace (принудительно в Route Handler).
-- expires_at: Route Handler устанавливает now() + interval '7 days'.
-- code: base64url, 16 байт (SEC-02, onitask_security_.md §3).
-- created_by → workers(id) (не profiles — инвайт создаёт участник workspace).
CREATE TABLE public.invite_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code         text        UNIQUE NOT NULL,
  created_by   uuid        NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  max_uses     int         NOT NULL DEFAULT 10 CHECK (max_uses > 0),
  used_count   int         NOT NULL DEFAULT 0  CHECK (used_count >= 0),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_links_workspace
  ON public.invite_links (workspace_id)
  WHERE is_active = true;
CREATE INDEX idx_invite_links_code
  ON public.invite_links (code)
  WHERE is_active = true;

-- 4.2 task_column_history (Master §6.3)
-- moved_by заполняется Route Handler отдельным UPDATE после INSERT.
-- Known race condition: Medium, принят осознанно (Master §6.3).
CREATE TABLE public.task_column_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  from_column  text,
  to_column    text        NOT NULL,
  moved_by     uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  task_version int,
  metadata     jsonb,
  moved_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_column_history_task_id
  ON public.task_column_history (task_id);
CREATE INDEX idx_task_column_history_moved_at
  ON public.task_column_history (moved_at);
-- Для rework rate SQL (team_tab §4.2)
CREATE INDEX idx_task_column_history_rework
  ON public.task_column_history (task_id, moved_at, from_column, to_column);
-- Для attention_risk_pulse context_switches_today (A-11, sql_anomalies_.md §3.9)
CREATE INDEX idx_task_column_history_moved_by_date
  ON public.task_column_history (moved_by, moved_at)
  WHERE moved_by IS NOT NULL;
-- Для velocity_drop VIEW
CREATE INDEX idx_task_column_history_rework_done
  ON public.task_column_history (task_id, moved_at)
  WHERE to_column = 'done';

-- 4.3 enrichment_queue (Master §6.5)
-- Приоритет воркера: card(1) > workspace_context_rebuild(2) > doc_process(3)
CREATE TABLE public.enrichment_queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN (
                 'card', 'suggestion', 'flow_alert', 'bot_notify',
                 'duplicate_check', 'doc_process', 'workspace_context_rebuild'
               )),
  payload      jsonb       NOT NULL DEFAULT '{}',
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  locked_at    timestamptz
);

CREATE INDEX idx_enrichment_queue_scheduled
  ON public.enrichment_queue (scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_enrichment_queue_workspace
  ON public.enrichment_queue (workspace_id, status, scheduled_at)
  WHERE status = 'pending';
-- Дедупликация: один pending duplicate_check на задачу
CREATE UNIQUE INDEX idx_enrichment_queue_dedup_duplicate
  ON public.enrichment_queue (workspace_id, (payload->>'task_id'))
  WHERE type = 'duplicate_check' AND status = 'pending';
-- Дедупликация: один pending context rebuild на workspace
CREATE UNIQUE INDEX idx_enrichment_queue_dedup_context_rebuild
  ON public.enrichment_queue (workspace_id)
  WHERE type = 'workspace_context_rebuild' AND status = 'pending';

-- 4.4 task_enrichments (Master §6.6)
CREATE TABLE public.task_enrichments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            uuid        NOT NULL UNIQUE
                     REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id       uuid        NOT NULL
                     REFERENCES public.workspaces(id) ON DELETE CASCADE,
  anomaly            jsonb,
  ai_hint            text,
  cognitive_weight   int         CHECK (cognitive_weight IN (1, 2, 3)),
  story_points       int,
  sp_estimation_type text        CHECK (sp_estimation_type IN ('hours', 'days', 'abstract')),
  suggested_tags     text[],
  enrichment_status  text        NOT NULL DEFAULT 'pending'
                     CHECK (enrichment_status IN
                       ('pending', 'processing', 'done', 'failed', 'stale')),
  enrichment_notes   text,
  model_used         text,
  enriched_at        timestamptz,
  failed_at          timestamptz,
  attempts           int         NOT NULL DEFAULT 0,
  last_attempt_at    timestamptz,
  requested_at       timestamptz
);

-- 4.5 agent_events (Master §6.7)
-- Retention: 7 дней (GC job в Section 8).
CREATE TABLE public.agent_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tool         text        NOT NULL CHECK (tool IN (
                 'create_task', 'get_tasks_by_column', 'move_task',
                 'escalate_task', 'bot_command', 'send_message_to_chat',
                 'undo', 'handoff_task'
               )),
  agent_name   text        NOT NULL,
  task_id      uuid        REFERENCES public.tasks(id) ON DELETE SET NULL,
  summary      text,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  state_before jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_events_workspace
  ON public.agent_events (workspace_id, created_at);
CREATE INDEX idx_agent_events_task_id
  ON public.agent_events (task_id);
-- Для handoff_chain VIEW и trg_handoff_chain_alert (sql_anomalies_.md §5.7)
CREATE INDEX idx_agent_events_handoff_task
  ON public.agent_events (task_id, tool, created_at)
  WHERE tool = 'handoff_task';

-- 4.6 agent_memory (Master §6.8)
-- RAG активируется при ≥500 done-задач в workspace (ai_.md §2.2).
CREATE TABLE public.agent_memory (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id      uuid        REFERENCES public.tasks(id) ON DELETE CASCADE,
  summary_text text,
  embedding    vector(1024),
  period_start timestamptz,
  period_end   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_memory_embedding
  ON public.agent_memory USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- 4.7 workspace_telegram_chats (Master §6.9)
-- linked_by → profiles(id) per INV-10 (всегда человек-администратор, не worker).
CREATE TABLE public.workspace_telegram_chats (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chat_id               bigint      NOT NULL,
  title                 text,
  is_active             boolean     NOT NULL DEFAULT true,
  notification_settings jsonb       NOT NULL DEFAULT
                        '{"on_inbox_move": false, "on_overload": false, "quiet_hours": []}',
  linked_by             uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, chat_id)
);

-- 4.8 task_events (Master §6.10)
-- Заменяет tracker.task_events и tracker.comments (event_type='comment').
-- Retention: 30 дней → Memory Consolidation (ai_.md §5) → agent_memory.
CREATE TABLE public.task_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id      uuid        REFERENCES public.tasks(id) ON DELETE CASCADE,
  event_type   text        NOT NULL CHECK (event_type IN (
                 'status_change', 'comment', 'assignment',
                 'enrichment', 'parse_rewrite'
               )),
  payload      jsonb       NOT NULL DEFAULT '{}',
  consolidated boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_events_task_id
  ON public.task_events (task_id);
CREATE INDEX idx_task_events_consolidated
  ON public.task_events (consolidated, created_at)
  WHERE consolidated = false;

-- 4.9 consolidation_errors (Master §6.11)
CREATE TABLE public.consolidation_errors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_event_id uuid,
  error_message text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 4.10 workspace_documents (Master §6.13)
CREATE TABLE public.workspace_documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  filename     text        NOT NULL,
  file_type    text        CHECK (file_type IN ('markdown', 'text')),
  size_bytes   int         NOT NULL,
  checksum     text        NOT NULL,
  chunk_count  int         NOT NULL DEFAULT 0,
  status       text        NOT NULL DEFAULT 'processing'
               CHECK (status IN ('processing', 'ready', 'failed')),
  uploaded_by  uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 4.11 workspace_doc_chunks (Master §6.13)
CREATE TABLE public.workspace_doc_chunks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid        NOT NULL REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chunk_index  int         NOT NULL,
  content      text        NOT NULL,
  meta_headers jsonb,
  embedding    vector(1024),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_chunks_embedding
  ON public.workspace_doc_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
CREATE INDEX idx_doc_chunks_workspace
  ON public.workspace_doc_chunks (workspace_id);

-- 4.12 assignment_history (Master §6.14)
-- Заполняется ТОЛЬКО триггером trg_record_assignment_snapshot (INV-12).
-- Retention: бессрочно в рамках workspace; CASCADE при удалении workspace.
CREATE TABLE public.assignment_history (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id                   uuid        REFERENCES public.tasks(id) ON DELETE SET NULL,
  assignee_id               uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  assigned_by               uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  snapshot_attention_risk   int,
  snapshot_active_tasks     int,
  snapshot_context_switches int,
  snapshot_blocked_tasks    int,
  snapshot_review_tasks     int,
  snapshot_critical_tasks   int,
  outcome_status            text        NOT NULL DEFAULT 'pending'
                            CHECK (outcome_status IN (
                              'pending', 'completed_on_time', 'deadline_missed',
                              'reassigned', 'returned_from_review', 'escalated'
                            )),
  assigned_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignment_history_workspace
  ON public.assignment_history (workspace_id);
CREATE INDEX idx_assignment_history_assignee
  ON public.assignment_history (assignee_id, assigned_at DESC);
CREATE INDEX idx_assignment_history_task
  ON public.assignment_history (task_id);
CREATE INDEX idx_assignment_history_pending
  ON public.assignment_history (workspace_id, outcome_status)
  WHERE outcome_status = 'pending';

-- 4.13 task_relations (Master §6.16, A-12)
-- INV-13: workspace_id передаётся явно при каждом INSERT.
-- Канонические веса (иммутабельны, A-12):
--   blocks=1.0, spawned_from=0.8, mentions=0.3
CREATE TABLE public.task_relations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  from_task_id  uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  to_task_id    uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  relation_type text        NOT NULL
                CHECK (relation_type IN ('blocks', 'spawned_from', 'mentions')),
  weight        float       NOT NULL CHECK (weight BETWEEN 0.0 AND 1.0),
  created_by    uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_task_id, to_task_id, relation_type)
);

CREATE INDEX idx_task_relations_from
  ON public.task_relations (from_task_id);
CREATE INDEX idx_task_relations_to
  ON public.task_relations (to_task_id);
CREATE INDEX idx_task_relations_workspace
  ON public.task_relations (workspace_id);
-- Горячий путь: cascade_unblock, orphan_blocker, smart backlog
CREATE INDEX idx_task_relations_blocks
  ON public.task_relations (relation_type, workspace_id)
  WHERE relation_type = 'blocks';
-- Для EXISTS sub-query в orphan_blockers VIEW (sql_anomalies_.md §3.10)
CREATE INDEX idx_task_relations_to_blocks
  ON public.task_relations (to_task_id, relation_type, workspace_id)
  WHERE relation_type = 'blocks';

-- ============================================================
-- SECTION 5: Функции и RPCs
-- ============================================================

-- ── 5.1 Инициализация workspace ──────────────────────────────

-- Создаёт счётчик задач при создании workspace.
CREATE OR REPLACE FUNCTION public.init_task_counter()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.workspace_task_counters (workspace_id, last_number)
  VALUES (NEW.id, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создаёт 4 дефолтные колонки канбана для каждого нового workspace.
-- WIP-лимиты: backlog=15, in_progress=5, review=4, done=без лимита.
CREATE OR REPLACE FUNCTION public.init_workspace_columns()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tracker.columns (workspace_id, name, system_status, wip_limit, position)
  VALUES
    (NEW.id, 'backlog',     'backlog',     15,   1.0),
    (NEW.id, 'in_progress', 'in_progress', 5,    2.0),
    (NEW.id, 'review',      'review',      4,    3.0),
    (NEW.id, 'done',        'done',        NULL, 4.0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.2 Нумерация задач (Master §6.12) ───────────────────────

CREATE OR REPLACE FUNCTION public.next_task_number(p_workspace_id uuid)
RETURNS int AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE public.workspace_task_counters
  SET    last_number = last_number + 1
  WHERE  workspace_id = p_workspace_id
  RETURNING last_number INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Task counter not found for workspace %', p_workspace_id;
  END IF;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.assign_task_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.task_number := public.next_task_number(NEW.workspace_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- task_prefix иммутабелен после создания (INV-11)
CREATE OR REPLACE FUNCTION public.prevent_task_prefix_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.task_prefix IS NOT NULL
     AND NEW.task_prefix != OLD.task_prefix THEN
    RAISE EXCEPTION
      'task_prefix is immutable after creation. '
      'Changing it would invalidate all existing task references.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.3 Движение задачи и кэш эмбеддингов ────────────────────

-- Обновляет moved_to_column_at и записывает историю (Master §6.3).
CREATE OR REPLACE FUNCTION public.record_task_column_move()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."column" IS DISTINCT FROM NEW."column" THEN
    INSERT INTO public.task_column_history
      (task_id, from_column, to_column, task_version)
    VALUES
      (NEW.id, OLD."column", NEW."column", NEW.version);
    NEW.moved_to_column_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Инвалидирует кэш эмбеддинга при изменении title или description.
-- Cache-hit НЕ обновляет embedding_updated_at — это намеренно.
-- (Master v0.13.2, ai_.md §2.2)
CREATE OR REPLACE FUNCTION public.invalidate_task_embedding()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.title IS DISTINCT FROM NEW.title)
     OR (OLD.description IS DISTINCT FROM NEW.description) THEN
    NEW.embedding             := NULL;
    NEW.embedding_hash        := NULL;
    NEW.embedding_updated_at  := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.4 Автосоздание агента (INV-04) ─────────────────────────

CREATE OR REPLACE FUNCTION public.auto_create_agent_worker()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.workers (workspace_id, type, display_name, source_id)
  VALUES (
    NEW.workspace_id,
    'agent',
    NEW.agent_name,
    'agent::' || NEW.agent_name
  )
  ON CONFLICT (workspace_id, source_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.5 Вспомогательная функция алертов (sql_anomalies_.md §5.1) ──

-- Вставляет bot_notify с дедупликацией: 1 алерт / 2 часа / (alert_type, task_id).
CREATE OR REPLACE FUNCTION public.send_alert_immediate(
  p_workspace_id uuid,
  p_alert_type   text,
  p_task_id      uuid,
  p_text         text
) RETURNS void AS $$
DECLARE
  last_sent timestamptz;
BEGIN
  SELECT created_at INTO last_sent
  FROM public.enrichment_queue
  WHERE type                     = 'bot_notify'
    AND payload->>'workspace_id' = p_workspace_id::text
    AND payload->>'alert_type'   = p_alert_type
    AND payload->>'task_id'      = p_task_id::text
  ORDER BY created_at DESC
  LIMIT 1;

  IF last_sent IS NULL OR last_sent < NOW() - INTERVAL '2 hours' THEN
    INSERT INTO public.enrichment_queue
      (workspace_id, type, payload, status, scheduled_at)
    VALUES (
      p_workspace_id,
      'bot_notify',
      jsonb_build_object(
        'workspace_id', p_workspace_id,
        'alert_type',   p_alert_type,
        'text',         p_text,
        'task_id',      p_task_id
      ),
      'pending',
      NOW()
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── 5.6 Алерты эскалации и разблокировки ─────────────────────

-- Контракт: Route Handler/Edge Function устанавливает
-- SET LOCAL app.skip_alert_triggers = 'true' перед автоматическими мутациями.

CREATE OR REPLACE FUNCTION public.trigger_escalation_alert()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.needs_human = true
     AND (OLD.needs_human IS DISTINCT FROM NEW.needs_human) THEN
    PERFORM public.send_alert_immediate(
      NEW.workspace_id,
      'escalation',
      NEW.id,
      format(
        '🆘 Задача «%s» требует вмешательства (причина: %s)',
        NEW.title,
        COALESCE(NEW.escalation_reason, 'не указана')
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Парный сигнал к trigger_escalation_alert (sql_anomalies_.md §5.5)
CREATE OR REPLACE FUNCTION public.trigger_resolution_notify()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.needs_human = true AND NEW.needs_human = false THEN
    PERFORM public.send_alert_immediate(
      NEW.workspace_id,
      'escalation_resolved',
      NEW.id,
      format(
        '✅ Задача «%s» разблокирована. Агент может продолжить работу.',
        NEW.title
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.7 Очередь проверки дублей (sql_anomalies_.md §5.3) ─────

CREATE OR REPLACE FUNCTION public.enqueue_duplicate_check()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.enrichment_queue
    (workspace_id, type, payload, status, scheduled_at)
  VALUES (
    NEW.workspace_id,
    'duplicate_check',
    jsonb_build_object(
      'task_id',      NEW.id,
      'title',        NEW.title,
      'workspace_id', NEW.workspace_id
    ),
    'pending',
    NOW() + INTERVAL '5 seconds'
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.8 Снапшот назначения (Master §6.14, INV-12) ────────────
-- Читает VIEW attention_risk_pulse — создан в Section 6 ниже.
-- PL/pgSQL компилируется при вызове, не при определении → порядок безопасен.

CREATE OR REPLACE FUNCTION public.record_assignment_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  v_risk     int;
  v_active   int;
  v_switches int;
  v_blocked  int;
  v_review   int;
  v_critical int;
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    SELECT
      attention_risk_score,
      active_tasks,
      context_switches_today,
      blocked_tasks,
      review_tasks,
      critical_deadline_tasks
    INTO v_risk, v_active, v_switches, v_blocked, v_review, v_critical
    FROM public.attention_risk_pulse
    WHERE worker_id    = NEW.assigned_to
      AND workspace_id = NEW.workspace_id;

    INSERT INTO public.assignment_history (
      workspace_id, task_id, assignee_id,
      snapshot_attention_risk, snapshot_active_tasks,
      snapshot_context_switches, snapshot_blocked_tasks,
      snapshot_review_tasks, snapshot_critical_tasks
    ) VALUES (
      NEW.workspace_id, NEW.id, NEW.assigned_to,
      v_risk, v_active, v_switches, v_blocked, v_review, v_critical
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.9 Исход назначения (sql_anomalies_.md §5.6) ────────────

CREATE OR REPLACE FUNCTION public.update_assignment_outcome()
RETURNS TRIGGER AS $$
BEGIN
  -- Задача завершена
  IF NEW."column" = 'done' AND OLD."column" != 'done' THEN
    UPDATE public.assignment_history
    SET
      outcome_status = CASE
        WHEN OLD.deadline IS NOT NULL
             AND OLD.deadline::date < CURRENT_DATE
          THEN 'deadline_missed'
        ELSE 'completed_on_time'
      END,
      resolved_at = NOW()
    WHERE task_id = NEW.id AND outcome_status = 'pending';

  -- Задача вернулась из review
  ELSIF OLD."column" = 'review' AND NEW."column" = 'in_progress' THEN
    UPDATE public.assignment_history
    SET outcome_status = 'returned_from_review', resolved_at = NOW()
    WHERE task_id        = NEW.id
      AND assignee_id    = NEW.assigned_to
      AND outcome_status = 'pending';

  -- Переназначение
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
        AND OLD.assigned_to IS NOT NULL
        AND NEW.assigned_to IS NOT NULL THEN
    UPDATE public.assignment_history
    SET outcome_status = 'reassigned', resolved_at = NOW()
    WHERE task_id        = NEW.id
      AND assignee_id    = OLD.assigned_to
      AND outcome_status = 'pending';

  -- Эскалация
  ELSIF NEW.needs_human = true
        AND (OLD.needs_human IS DISTINCT FROM NEW.needs_human) THEN
    UPDATE public.assignment_history
    SET outcome_status = 'escalated', resolved_at = NOW()
    WHERE task_id = NEW.id AND outcome_status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.10 Каскадная разблокировка (Master §6.16) ──────────────

CREATE OR REPLACE FUNCTION public.cascade_unblock()
RETURNS TRIGGER AS $$
DECLARE
  v_unblocked_ids uuid[];
BEGIN
  IF NEW."column" = 'done' AND OLD."column" != 'done' THEN
    WITH newly_unblocked AS (
      SELECT tr.to_task_id
      FROM public.task_relations tr
      WHERE tr.from_task_id  = NEW.id
        AND tr.relation_type = 'blocks'
        AND tr.workspace_id  = NEW.workspace_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.task_relations tr2
          JOIN public.tasks t2 ON t2.id = tr2.from_task_id
          WHERE tr2.to_task_id    = tr.to_task_id
            AND tr2.relation_type = 'blocks'
            AND tr2.from_task_id != NEW.id
            AND t2."column"      != 'done'
        )
    ),
    updated AS (
      UPDATE public.tasks
      SET is_blocked = false
      WHERE id = ANY(SELECT to_task_id FROM newly_unblocked)
        AND is_blocked = true
      RETURNING id
    )
    SELECT array_agg(id) INTO v_unblocked_ids FROM updated;

    IF v_unblocked_ids IS NOT NULL
       AND array_length(v_unblocked_ids, 1) > 0 THEN
      INSERT INTO public.enrichment_queue
        (workspace_id, type, payload, status, scheduled_at)
      VALUES (
        NEW.workspace_id,
        'bot_notify',
        jsonb_build_object(
          'workspace_id',       NEW.workspace_id,
          'alert_type',         'cascade_unblock',
          'completed_task_id',  NEW.id,
          'unblocked_task_ids', to_jsonb(v_unblocked_ids)
        ),
        'pending',
        NOW()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.11 Инвалидация контекста воркспейса (Master §6.16) ─────

CREATE OR REPLACE FUNCTION public.context_invalidate()
RETURNS TRIGGER AS $$
BEGIN
  -- Событие на tasks
  IF TG_TABLE_NAME = 'tasks' THEN
    IF (NEW.needs_human IS DISTINCT FROM OLD.needs_human AND NEW.needs_human = true)
    OR (NEW.handoff_to  IS DISTINCT FROM OLD.handoff_to  AND NEW.handoff_to IS NOT NULL)
    OR (NEW.priority    IS DISTINCT FROM OLD.priority    AND NEW.priority = 'critical')
    THEN
      UPDATE public.workspace_settings
        SET context_stale = true
        WHERE workspace_id = NEW.workspace_id;

      INSERT INTO public.enrichment_queue
        (workspace_id, type, payload, status, scheduled_at)
      VALUES (
        NEW.workspace_id,
        'workspace_context_rebuild',
        jsonb_build_object('workspace_id', NEW.workspace_id),
        'pending',
        NOW()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Событие на sprints
  IF TG_TABLE_NAME = 'sprints' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('active', 'completed') THEN
      UPDATE public.workspace_settings
        SET context_stale = true
        WHERE workspace_id = NEW.workspace_id;

      INSERT INTO public.enrichment_queue
        (workspace_id, type, payload, status, scheduled_at)
      VALUES (
        NEW.workspace_id,
        'workspace_context_rebuild',
        jsonb_build_object('workspace_id', NEW.workspace_id),
        'pending',
        NOW()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.12 Алерт цепочки handoff (sql_anomalies_.md §5.7) ──────
-- Алерт при ≥3 передачах задачи за 7 дней без завершения.
-- Не использует app.skip_alert_triggers — handoff всегда от агента.

CREATE OR REPLACE FUNCTION public.notify_handoff_chain()
RETURNS TRIGGER AS $$
DECLARE
  v_handoff_count int;
  v_task_title    text;
  v_workspace_id  uuid;
  v_full_id       text;
BEGIN
  IF NEW.tool != 'handoff_task' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_handoff_count
  FROM public.agent_events
  WHERE task_id    = NEW.task_id
    AND tool       = 'handoff_task'
    AND created_at > NOW() - INTERVAL '7 days';

  -- Алерт при 3, 6, 9... (кратность 3 защищает от спама)
  IF v_handoff_count >= 3 AND v_handoff_count % 3 = 0 THEN
    SELECT t.title, t.workspace_id,
           w.task_prefix || '-' || t.task_number::text
    INTO v_task_title, v_workspace_id, v_full_id
    FROM public.tasks t
    JOIN public.workspaces w ON w.id = t.workspace_id
    WHERE t.id = NEW.task_id;

    PERFORM public.send_alert_immediate(
      v_workspace_id,
      'handoff_chain',
      NEW.task_id,
      format(
        '🔄 %s передавалась агентами %s раз за 7 дней без завершения. Проверь задачу.',
        COALESCE(v_full_id, NEW.task_id::text),
        v_handoff_count
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 5.13 RPCs ────────────────────────────────────────────────

-- Хелперы нумерации задач (Master §6.12)
CREATE OR REPLACE FUNCTION public.task_full_id(p_task_id uuid)
RETURNS text AS $$
  SELECT w.task_prefix || '-' || t.task_number::text
  FROM public.tasks t
  JOIN public.workspaces w ON w.id = t.workspace_id
  WHERE t.id = p_task_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.find_task_by_full_id(p_full_id text)
RETURNS uuid AS $$
DECLARE
  v_prefix text;
  v_number int;
BEGIN
  v_prefix := split_part(p_full_id, '-', 1);
  v_number := split_part(p_full_id, '-', 2)::int;
  RETURN (
    SELECT t.id
    FROM public.tasks t
    JOIN public.workspaces w ON w.id = t.workspace_id
    WHERE w.task_prefix = v_prefix
      AND t.task_number = v_number
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Семантический поиск задач (Master §6.1, ai_.md §2.2)
CREATE OR REPLACE FUNCTION public.match_tasks(
  query_embedding vector(1024),
  match_count     int,
  min_similarity  float,
  exclude_task_id uuid,
  p_workspace_id  uuid
) RETURNS TABLE(task_id uuid, similarity float) AS $$
  SELECT id,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.tasks
  WHERE embedding IS NOT NULL
    AND id           != exclude_task_id
    AND workspace_id  = p_workspace_id
    AND 1 - (embedding <=> query_embedding) >= min_similarity
  ORDER BY similarity DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- Поиск по долгосрочной памяти агента (Master §6.8)
CREATE OR REPLACE FUNCTION public.match_agent_memory(
  query_embedding vector(1024),
  match_count     int,
  min_similarity  float,
  p_workspace_id  uuid
) RETURNS TABLE(
  memory_id    uuid,
  task_id      uuid,
  summary_text text,
  similarity   float,
  period_start timestamptz
) AS $$
  SELECT
    id,
    task_id,
    summary_text,
    1 - (embedding <=> query_embedding) AS similarity,
    period_start
  FROM public.agent_memory
  WHERE workspace_id = p_workspace_id
    AND 1 - (embedding <=> query_embedding) >= min_similarity
  ORDER BY similarity DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- Поиск по чанкам документов (Master §6.13)
CREATE OR REPLACE FUNCTION public.match_doc_chunks(
  query_embedding vector(1024),
  match_count     int,
  min_similarity  float,
  p_workspace_id  uuid
) RETURNS TABLE(
  chunk_id     uuid,
  content      text,
  similarity   float,
  filename     text,
  meta_headers jsonb
) AS $$
  SELECT
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    d.filename,
    c.meta_headers
  FROM public.workspace_doc_chunks c
  JOIN public.workspace_documents d ON d.id = c.document_id
  WHERE c.workspace_id = p_workspace_id
    AND d.status       = 'ready'
    AND 1 - (c.embedding <=> query_embedding) >= min_similarity
  ORDER BY similarity DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- Двухуровневый обход графа зависимостей (Master §6.16, A-12)
CREATE OR REPLACE FUNCTION public.get_task_subgraph(
  p_task_id      uuid,
  p_workspace_id uuid
) RETURNS TABLE(
  from_task_id  uuid,
  to_task_id    uuid,
  relation_type text,
  weight        float,
  depth         int
) AS $$
  -- Глубина 1: все прямые связи
  SELECT tr.from_task_id, tr.to_task_id, tr.relation_type, tr.weight, 1
  FROM public.task_relations tr
  WHERE (tr.from_task_id = p_task_id OR tr.to_task_id = p_task_id)
    AND tr.workspace_id = p_workspace_id

  UNION ALL

  -- Глубина 2: только 'blocks' от прямых соседей
  -- (mentions/spawned_from на глубине 2 — шум без ценности)
  SELECT tr2.from_task_id, tr2.to_task_id, tr2.relation_type, tr2.weight, 2
  FROM public.task_relations tr
  JOIN public.task_relations tr2
    ON (tr2.from_task_id = tr.to_task_id OR tr2.to_task_id = tr.from_task_id)
  WHERE (tr.from_task_id = p_task_id OR tr.to_task_id = p_task_id)
    AND tr.workspace_id   = p_workspace_id
    AND tr2.workspace_id  = p_workspace_id
    AND tr2.relation_type = 'blocks'
    AND tr2.from_task_id != p_task_id
    AND tr2.to_task_id   != p_task_id;
$$ LANGUAGE sql STABLE;

-- Поиск дублей по схожести заголовка (sql_anomalies_.md §5.3)
CREATE OR REPLACE FUNCTION public.find_duplicate_tasks(
  p_task_id      uuid,
  p_title        text,
  p_workspace_id uuid,
  p_threshold    float DEFAULT 0.7
) RETURNS TABLE(id uuid, title text, similarity float) AS $$
  SELECT
    t2.id,
    t2.title,
    similarity(p_title, t2.title) AS similarity
  FROM public.tasks t2
  WHERE t2.workspace_id = p_workspace_id
    AND t2.id          != p_task_id
    AND t2."column"    != 'done'
    AND t2.created_at   > NOW() - INTERVAL '30 days'
    AND p_title % t2.title
    AND similarity(p_title, t2.title) > p_threshold
  ORDER BY similarity DESC
  LIMIT 5;
$$ LANGUAGE sql;

-- ============================================================
-- SECTION 6: Views — Детекция аномалий
-- (sql_anomalies_.md §3 — DDL только здесь, не в feature-документах)
-- ============================================================

-- attention_risk_pulse ДОЛЖЕН быть создан ДО трггера trg_record_assignment_snapshot.
-- Детерминированная метрика риска назначения 0-100 (A-11, sql_anomalies_.md §3.9).
CREATE OR REPLACE VIEW public.attention_risk_pulse AS
WITH worker_task_metrics AS (
  SELECT
    w.id           AS worker_id,
    w.display_name,
    w.workspace_id,
    -- Фактор 1: Активные обязательства (×15)
    COUNT(DISTINCT t.id) FILTER (
      WHERE t."column"    = 'in_progress'
        AND t.assigned_to = w.id
        AND t.is_inbox    = false
    ) AS active_tasks,
    -- Фактор 3а: Блокировки (×12)
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.is_blocked   = true
        AND t.assigned_to  = w.id
        AND t."column"    != 'done'
    ) AS blocked_tasks,
    -- Фактор 3б: Ревью-очередь (×5)
    COUNT(DISTINCT t.id) FILTER (
      WHERE t."column"    = 'review'
        AND t.reviewer_id = w.id
    ) AS review_tasks,
    -- Фактор 4: Deadline-давление (×15)
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.deadline_urgency = 'critical'
        AND t.assigned_to      = w.id
        AND t."column"        != 'done'
        AND t.is_inbox         = false
    ) AS critical_deadline_tasks
  FROM public.workers w
  INNER JOIN public.workspace_settings ws ON w.workspace_id = ws.workspace_id
  LEFT JOIN public.tasks t ON (
    (t.assigned_to = w.id AND t."column" = 'in_progress')
    OR
    (t.reviewer_id = w.id AND t."column" = 'review')
  )
  AND t.is_blocked   = false
  AND t.is_inbox     = false
  AND t.workspace_id = w.workspace_id
  WHERE w.type      = 'human'
    AND w.is_active = true
  GROUP BY w.id, w.display_name, w.workspace_id
),
worker_switch_metrics AS (
  -- Фактор 2: Переключения контекста за сегодня (×10)
  -- CAVEAT: moved_by nullable (race condition, Master §6.3) → ~5-10% потеря точности
  SELECT
    tch.moved_by                AS worker_id,
    COUNT(DISTINCT tch.task_id) AS context_switches_today
  FROM public.task_column_history tch
  WHERE tch.moved_by IS NOT NULL
    AND tch.moved_at >= CURRENT_DATE
  GROUP BY tch.moved_by
),
scored AS (
  SELECT
    wtm.worker_id,
    wtm.display_name,
    wtm.workspace_id,
    wtm.active_tasks,
    COALESCE(wsm.context_switches_today, 0) AS context_switches_today,
    wtm.blocked_tasks,
    wtm.review_tasks,
    wtm.critical_deadline_tasks,
    LEAST(100, ROUND(
      wtm.active_tasks                         * 15.0 +
      COALESCE(wsm.context_switches_today, 0) * 10.0 +
      wtm.blocked_tasks                        * 12.0 +
      wtm.review_tasks                         *  5.0 +
      wtm.critical_deadline_tasks              * 15.0
    )) AS attention_risk_score
  FROM worker_task_metrics wtm
  LEFT JOIN worker_switch_metrics wsm ON wsm.worker_id = wtm.worker_id
)
SELECT
  *,
  CASE
    WHEN attention_risk_score >= 80 THEN 'critical'
    WHEN attention_risk_score >= 60 THEN 'warning'
    ELSE                                 'ok'
  END AS risk_level
FROM scored;

-- Зависшие задачи >72ч без движения (sql_anomalies_.md §3.1)
CREATE OR REPLACE VIEW public.stuck_tasks AS
SELECT
  t.id, t.title, t."column", t.assigned_to,
  w.display_name AS assignee_name,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_stuck,
  t.workspace_id
FROM public.tasks t
JOIN public.workers w
  ON t.assigned_to = w.id AND t.workspace_id = w.workspace_id
WHERE t."column" IN ('in_progress', 'review')
  AND t.moved_to_column_at < NOW() - INTERVAL '72 hours'
  AND t.is_blocked = false;

-- Перегруженные исполнители (sql_anomalies_.md §3.2)
CREATE OR REPLACE VIEW public.overloaded_workers AS
WITH worker_load AS (
  SELECT
    w.id, w.display_name, w.workspace_id,
    COALESCE(SUM(COALESCE(t.cognitive_weight, 1)), 0) AS total_load,
    COALESCE(
      CASE
        WHEN ws.flow_config->>'overload_threshold' ~ '^[0-9]+$'
        THEN (ws.flow_config->>'overload_threshold')::int
        ELSE NULL
      END, 6
    ) AS threshold
  FROM public.workers w
  INNER JOIN public.workspace_settings ws ON w.workspace_id = ws.workspace_id
  LEFT JOIN public.tasks t ON (
    (t.assigned_to = w.id AND t."column" = 'in_progress')
    OR
    (t.reviewer_id = w.id AND t."column" = 'review')
  )
  AND t.is_blocked   = false
  AND t.is_inbox     = false
  AND t.workspace_id = w.workspace_id
  WHERE w.type = 'human'
  GROUP BY w.id, w.display_name, w.workspace_id, ws.flow_config
)
SELECT id, display_name, workspace_id, total_load, threshold
FROM worker_load
WHERE total_load > threshold;

-- Узкие места колонок (sql_anomalies_.md §3.3)
CREATE OR REPLACE VIEW public.bottleneck_columns AS
SELECT
  c.workspace_id,
  c.name   AS column_name,
  c.wip_limit,
  m.val    AS multiplier,
  COUNT(t.id) AS task_count,
  CASE
    WHEN COUNT(t.id) > c.wip_limit * m.val THEN 'critical'
    WHEN COUNT(t.id) > c.wip_limit         THEN 'warning'
    ELSE 'ok'
  END AS severity
FROM tracker.columns c
INNER JOIN public.workspace_settings ws ON c.workspace_id = ws.workspace_id
LEFT JOIN public.tasks t
  ON t."column" = c.name
 AND t.workspace_id = c.workspace_id
 AND t."column"    != 'done'
LEFT JOIN LATERAL (
  SELECT COALESCE(
    CASE
      WHEN ws.flow_config->>'wip_alert_multiplier' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (ws.flow_config->>'wip_alert_multiplier')::float
      ELSE NULL
    END, 1.5
  ) AS val
) m ON TRUE
WHERE c.wip_limit IS NOT NULL
GROUP BY c.id, c.name, c.wip_limit, c.workspace_id, m.val
HAVING COUNT(t.id) > c.wip_limit;

-- Дубликаты задач по схожести заголовков >0.7 (sql_anomalies_.md §3.4)
CREATE OR REPLACE VIEW public.duplicate_tasks AS
SELECT
  t1.id    AS task1_id, t1.title AS title1,
  t2.id    AS task2_id, t2.title AS title2,
  similarity(t1.title, t2.title) AS similarity,
  t1.workspace_id
FROM public.tasks t1
JOIN public.tasks t2
  ON t1.workspace_id = t2.workspace_id
 AND t1.id < t2.id
 AND t1.title % t2.title
WHERE t1."column" != 'done'
  AND t2."column" != 'done'
  AND t1.created_at > NOW() - INTERVAL '30 days'
  AND t2.created_at > NOW() - INTERVAL '30 days'
  AND similarity(t1.title, t2.title) > 0.7;

-- Заблокированные без движения >48ч (sql_anomalies_.md §3.5)
CREATE OR REPLACE VIEW public.stale_blocked AS
SELECT id, title, "column", assigned_to, workspace_id, moved_to_column_at
FROM public.tasks
WHERE is_blocked = true
  AND moved_to_column_at < NOW() - INTERVAL '48 hours'
  AND "column" != 'done';

-- Снижение скорости спринта >30% (sql_anomalies_.md §3.6)
CREATE OR REPLACE VIEW public.velocity_drop AS
WITH daily_velocity AS (
  SELECT
    t.workspace_id,
    DATE(h.moved_at) AS day,
    SUM(COALESCE(te.story_points, 0)) AS points
  FROM public.task_column_history h
  JOIN public.tasks t ON t.id = h.task_id
  LEFT JOIN public.task_enrichments te ON te.task_id = h.task_id
  WHERE h.to_column = 'done'
    AND h.moved_at  > NOW() - INTERVAL '28 days'
  GROUP BY t.workspace_id, DATE(h.moved_at)
),
recent_avg AS (
  SELECT workspace_id,
         AVG(points)         AS avg_points,
         COUNT(DISTINCT day) AS days_count
  FROM daily_velocity
  WHERE day > NOW() - INTERVAL '14 days'
  GROUP BY workspace_id
),
previous_avg AS (
  SELECT workspace_id, AVG(points) AS avg_points
  FROM daily_velocity
  WHERE day BETWEEN NOW() - INTERVAL '28 days' AND NOW() - INTERVAL '15 days'
  GROUP BY workspace_id
)
SELECT
  r.workspace_id,
  r.avg_points  AS current_velocity,
  p.avg_points  AS previous_velocity,
  r.avg_points / NULLIF(p.avg_points, 0) AS ratio
FROM recent_avg r
JOIN previous_avg p ON r.workspace_id = p.workspace_id
WHERE r.avg_points / NULLIF(p.avg_points, 0) < 0.7
  AND r.days_count >= 14;

-- Ожидающие эскалации (sql_anomalies_.md §3.7)
CREATE OR REPLACE VIEW public.pending_escalations AS
SELECT
  t.id, t.title, t.escalation_reason, t.workspace_id,
  w.display_name AS assigned_agent,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_pending
FROM public.tasks t
LEFT JOIN public.workers w
  ON t.assigned_to = w.id AND t.workspace_id = w.workspace_id
WHERE t.needs_human = true
  AND t."column"   != 'done';

-- Перегрузка ревьювера: >2 задач на review (sql_anomalies_.md §3.8)
CREATE OR REPLACE VIEW public.review_backlog AS
SELECT
  t.reviewer_id,
  w.display_name AS reviewer_name,
  COUNT(t.id)    AS review_count,
  t.workspace_id
FROM public.tasks t
INNER JOIN public.workers w
  ON t.reviewer_id = w.id AND t.workspace_id = w.workspace_id
WHERE t."column" = 'review'
GROUP BY t.reviewer_id, w.display_name, t.workspace_id
HAVING COUNT(t.id) > 2;

-- Задачи с недействительной блокировкой (sql_anomalies_.md §3.10)
-- Сценарий: is_blocked=true, но все блокеры уже в done (phantom lock).
CREATE OR REPLACE VIEW public.orphan_blockers AS
SELECT
  t.id, t.title, t."column", t.workspace_id, t.assigned_to,
  w.display_name AS assignee_name,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_blocked
FROM public.tasks t
LEFT JOIN public.workers w
  ON t.assigned_to = w.id AND t.workspace_id = w.workspace_id
WHERE t.is_blocked = true
  AND t."column"  != 'done'
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_relations tr
    JOIN public.tasks blocker ON blocker.id = tr.from_task_id
    WHERE tr.to_task_id    = t.id
      AND tr.relation_type = 'blocks'
      AND tr.workspace_id  = t.workspace_id
      AND blocker."column" != 'done'
  );

-- Аномальные цепочки передач агентов (sql_anomalies_.md §3.11)
-- ≥3 handoff за 7 дней без перехода в done и без эскалации.
CREATE OR REPLACE VIEW public.handoff_chain AS
SELECT
  ae.task_id,
  t.title,
  t.workspace_id,
  t."column",
  COUNT(*)           AS handoff_count,
  MIN(ae.created_at) AS first_handoff_at,
  MAX(ae.created_at) AS last_handoff_at,
  EXTRACT(EPOCH FROM (NOW() - MIN(ae.created_at))) / 3600 AS hours_in_chain
FROM public.agent_events ae
JOIN public.tasks t ON t.id = ae.task_id
WHERE ae.tool        = 'handoff_task'
  AND ae.created_at  > NOW() - INTERVAL '7 days'
  AND t."column"    != 'done'
  AND t.needs_human  = false
GROUP BY ae.task_id, t.title, t.workspace_id, t."column"
HAVING COUNT(*) >= 3;

-- ============================================================
-- SECTION 7: Триггеры
-- ============================================================

-- ── Инициализация workspace ───────────────────────────────────

CREATE TRIGGER trg_init_task_counter
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.init_task_counter();

CREATE TRIGGER trg_init_workspace_columns
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.init_workspace_columns();

CREATE TRIGGER trg_prevent_task_prefix_update
BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.prevent_task_prefix_update();

-- ── Жизненный цикл задачи (BEFORE — выполняются алфавитно) ──

-- trg_assign_task_number: только INSERT
CREATE TRIGGER trg_assign_task_number
BEFORE INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.assign_task_number();

-- trg_invalidate_task_embedding (i) выполняется ДО trg_record_task_column_move (r)
CREATE TRIGGER trg_invalidate_task_embedding
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.invalidate_task_embedding();

-- trg_record_assignment_snapshot: только при изменении assigned_to
CREATE TRIGGER trg_record_assignment_snapshot
BEFORE UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.record_assignment_snapshot();

CREATE TRIGGER trg_record_task_column_move
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.record_task_column_move();

-- ── Жизненный цикл задачи (AFTER) ────────────────────────────

-- trg_enqueue_duplicate_check: только INSERT
CREATE TRIGGER trg_enqueue_duplicate_check
AFTER INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enqueue_duplicate_check();

-- При переходе в done: разблокировать downstream задачи
CREATE TRIGGER trg_cascade_unblock
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.cascade_unblock();

-- Пара: escalation ↔ resolution (оба на needs_human, взаимоисключающие условия)
CREATE TRIGGER trg_escalation_alert
AFTER UPDATE OF needs_human ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.trigger_escalation_alert();

CREATE TRIGGER trg_resolution_notify
AFTER UPDATE OF needs_human ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.trigger_resolution_notify();

-- Обновление датасета для Контура 2 (A-11)
CREATE TRIGGER trg_update_assignment_outcome
AFTER UPDATE OF "column", assigned_to, needs_human ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_assignment_outcome();

-- Инвалидация кэша контекста workspace
CREATE TRIGGER trg_context_invalidate_tasks
AFTER UPDATE OF needs_human, handoff_to, priority ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.context_invalidate();

-- ── Спринты ───────────────────────────────────────────────────

CREATE TRIGGER trg_context_invalidate_sprints
AFTER UPDATE OF status ON public.sprints
FOR EACH ROW EXECUTE FUNCTION public.context_invalidate();

-- ── Агентные события ──────────────────────────────────────────

-- Автосоздание worker-записи при первом появлении агента (INV-04)
CREATE TRIGGER trg_auto_create_agent_worker
AFTER INSERT ON public.agent_events
FOR EACH ROW EXECUTE FUNCTION public.auto_create_agent_worker();

-- Алерт при аномальной цепочке handoff
CREATE TRIGGER trg_handoff_chain_alert
AFTER INSERT ON public.agent_events
FOR EACH ROW EXECUTE FUNCTION public.notify_handoff_chain();

-- ============================================================
-- SECTION 8: pg_cron Jobs (Master §9)
-- ============================================================
-- Запускать ПОСЛЕ установки переменных:
--   ALTER DATABASE postgres SET app.edge_fn_url = '...';
--   ALTER DATABASE postgres SET app.service_key = '...';

-- Memory Consolidation: каждые 15 минут
SELECT cron.schedule('memory-consolidation', '*/15 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/consolidate',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_key')
    )
  );
$$);

-- GC agent_events: ежедневно 03:00 UTC (retention 7 дней)
SELECT cron.schedule('gc-agent-events', '0 3 * * *',
  $$DELETE FROM public.agent_events
    WHERE created_at < NOW() - INTERVAL '7 days'$$);

-- GC enrichment_queue done-записей: ежедневно 04:00 UTC (retention 3 дня)
SELECT cron.schedule('gc-enrichment-queue', '0 4 * * *',
  $$DELETE FROM public.enrichment_queue
    WHERE status      = 'done'
      AND processed_at < NOW() - INTERVAL '3 days'$$);

-- Мониторинг зависших pending: каждые 10 минут
SELECT cron.schedule('monitor-enrichment-queue', '*/10 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/queue-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_key')
    ),
    body    := (
      SELECT jsonb_build_object('stuck_count', COUNT(*))
      FROM public.enrichment_queue
      WHERE status       = 'pending'
        AND scheduled_at < NOW() - INTERVAL '10 minutes'
    )::text
  );
$$);

-- Авто-фейл зависших processing: каждый час
SELECT cron.schedule('auto-fail-locked-queue', '0 * * * *',
  $$UPDATE public.enrichment_queue
    SET status       = 'failed',
        processed_at = NOW()
    WHERE status    = 'processing'
      AND locked_at < NOW() - INTERVAL '2 hours'$$);

-- Daily Standup dispatcher: каждую минуту
SELECT cron.schedule('standup-dispatcher', '* * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/standup-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_key')
    )
  );
$$);

-- Fallback rebuild контекста workspace: каждый час
-- Основной путь — триггеры trg_context_invalidate_*. Cron — страховка.
SELECT cron.schedule('workspace-context-fallback', '0 * * * *', $$
  INSERT INTO public.enrichment_queue
    (workspace_id, type, payload, status, scheduled_at)
  SELECT
    workspace_id,
    'workspace_context_rebuild',
    jsonb_build_object('workspace_id', workspace_id),
    'pending',
    NOW()
  FROM public.workspace_settings
  WHERE context_stale = true
  ON CONFLICT DO NOTHING;
$$);

-- Ежедневные алерты аномалий: 06:00 UTC
SELECT cron.schedule('check-anomalies-daily', '0 6 * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/check-anomalies-daily',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_key')
    )
  );
$$);

-- Мониторинг деградации NeuralDeep Cold Path: каждый час (Master v0.13.0 A-6)
SELECT cron.schedule('enrichment-failure-alert', '0 * * * *', $$
  INSERT INTO public.enrichment_queue
    (workspace_id, type, payload, status, scheduled_at)
  SELECT
    te.workspace_id,
    'bot_notify',
    jsonb_build_object(
      'workspace_id', te.workspace_id,
      'alert_type',   'enrichment_degraded',
      'text', format(
        '⚠️ Cold Path деградация: %s задач не обогащены за последний час. '
        'NeuralDeep Hub может быть недоступен.',
        COUNT(*)
      )
    ),
    'pending',
    NOW()
  FROM public.task_enrichments te
  WHERE te.enrichment_status = 'failed'
    AND te.failed_at > NOW() - INTERVAL '1 hour'
  GROUP BY te.workspace_id
  HAVING COUNT(*) >= 5;
$$);

-- Weight decay: PLACEHOLDER — НЕ активен до task_relations > 100k строк
-- SELECT cron.schedule('weight-decay', '0 3 * * 0', $$
--   DELETE FROM public.task_relations
--   WHERE weight       < 0.1
--     AND created_at   < NOW() - INTERVAL '90 days'
--     AND relation_type = 'mentions';
-- $$);

-- ============================================================
-- END OF 001_init.sql
-- Следующий шаг: запустить 002_rls.sql
-- ============================================================
