-- ============================================================================
-- 075_bot_task_drafts_service_policy_scope.sql
-- onitask · Security-fix: bot_task_drafts_service_all был создан (миграция 030)
-- БЕЗ `TO service_role` → в Postgres это `TO PUBLIC`: любой клиент (в т.ч.
-- anon) имел полный доступ ко ВСЕМ строкам черновиков.
-- Фикс: явно ограничить политику ролью service_role (паттерн остальных
-- служебных таблиц). Owner-политики (auth.uid() = user_id) не трогаем —
-- они покрывают доступ аутентифицированного владельца к своим черновикам
-- (delete при удалении задачи, insert own draft и т.п.).
-- purge_expired_bot_task_drafts() — SECURITY DEFINER, RLS не затрагивает.
-- ============================================================================

DROP POLICY IF EXISTS bot_task_drafts_service_all ON public.bot_task_drafts;

CREATE POLICY bot_task_drafts_service_all ON public.bot_task_drafts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY bot_task_drafts_service_all ON public.bot_task_drafts IS
  'Service-role full access to bot_task_drafts (bot webhook, purge cron). Created 2026-09-05: миграция 030 забыла TO service_role → было TO PUBLIC (дыра для анонимов).';