-- ============================================================================
-- 074_performance_advisor_fk_indexes.sql
-- onitask · Performance Advisor (INFO: unindexed_foreign_keys).
-- Покрывающие индексы для FK-колонок без индекса. Чисто аддитивные DDL,
-- поведение не меняют. Выявлено 2026-09-05 по live-БД (полный список из
-- pg_constraint/pg_index, т.к. ответ advisor'а обрезается).
-- Примечание: частичные индексы (WHERE ...) НЕ используются RI-проверками FK
-- (например idx_tasks_assigned_to_column, idx_tasks_reviewer_column,
-- idx_tasks_active_claim, idx_enrichment_queue_workspace, ...), поэтому для
-- каждой такой колонки добавлен полный индекс с отдельным именем.
-- ============================================================================

-- bot_review_fix_pending
CREATE INDEX IF NOT EXISTS idx_bot_review_fix_pending_workspace
  ON public.bot_review_fix_pending (workspace_id);

-- dispatch_outbox
CREATE INDEX IF NOT EXISTS idx_dispatch_outbox_task
  ON public.dispatch_outbox (task_id);

-- dispatch_receipts
CREATE INDEX IF NOT EXISTS idx_dispatch_receipts_outbox
  ON public.dispatch_receipts (outbox_id);

-- enrichment_queue (полный индекс на workspace_id; существующий — частичный)
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_workspace_id
  ON public.enrichment_queue (workspace_id);

-- invite_links (имя idx_invite_links_workspace занято частичным индексом
-- WHERE is_active=true, поэтому полный индекс — под новым именем)
CREATE INDEX IF NOT EXISTS idx_invite_links_workspace_id_full
  ON public.invite_links (workspace_id);

-- mcp_agent_keys
CREATE INDEX IF NOT EXISTS idx_mcp_agent_keys_created_by
  ON public.mcp_agent_keys (created_by);
CREATE INDEX IF NOT EXISTS idx_mcp_agent_keys_workspace_id
  ON public.mcp_agent_keys (workspace_id);

-- profiles (имя idx_profiles_last_active_workspace занято частичным индексом
-- WHERE last_active_workspace_id IS NOT NULL — полный под новым именем)
CREATE INDEX IF NOT EXISTS idx_profiles_last_active_workspace_id_full
  ON public.profiles (last_active_workspace_id);

-- task_column_history
CREATE INDEX IF NOT EXISTS idx_task_column_history_moved_by
  ON public.task_column_history (moved_by);

-- tasks (существующие частичные индексы на этих колонках не используются
-- RI-проверками FK — добавляем полные)
CREATE INDEX IF NOT EXISTS idx_tasks_active_claim_id
  ON public.tasks (active_claim_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to
  ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by
  ON public.tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_reviewer_id
  ON public.tasks (reviewer_id);

-- telegram_message_queue
CREATE INDEX IF NOT EXISTS idx_telegram_queue_workspace_id
  ON public.telegram_message_queue (workspace_id);