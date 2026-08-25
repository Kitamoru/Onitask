-- ============================================================================
-- 050_deploy_wake.sql
-- Реактивный деплой-пинок и фикс-пинок для duty-агентов.
--
-- Проблема: деплой после апрува выполняет сам агент по плейбуку 'full'
--   (периодический скан done-колонки после timeout long-poll). Если агент
--   завершил сессию после перевода задачи в review — апрув никто не замечает,
--   деплой не происходит (кейс ONIT-7).
-- Решение: wait_for_tasks получает вторые критерии пробуждения:
--   - deploy_notify: задача агента перешла review -> done (одобрена);
--   - fix_notify:    задача агента возвращена review -> in_progress (на доработку).
-- Дедупликация доставки — маркерные события в agent_events с metadata.history_id
--   (id записи task_column_history): каждое одобрение/возврат доставляется ровно
--   один раз на агента, даже при рестарте сессии (окно детекта 24ч).
-- ============================================================================

ALTER TABLE public.agent_events DROP CONSTRAINT IF EXISTS agent_events_tool_check;

ALTER TABLE public.agent_events
  ADD CONSTRAINT agent_events_tool_check
  CHECK (tool IN (
    'create_task', 'get_tasks_by_column', 'move_task',
    'escalate_task', 'bot_command', 'send_message_to_chat',
    'undo', 'handoff_task',
    'deploy_notify', 'fix_notify'
  ));

COMMENT ON CONSTRAINT agent_events_tool_check ON public.agent_events IS
  'Duty-mode wake markers deploy_notify/fix_notify are written by wait_for_tasks (one per review->done / review->in_progress transition per agent, deduplicated by metadata.history_id).';