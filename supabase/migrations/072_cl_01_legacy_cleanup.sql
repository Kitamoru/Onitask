-- ============================================================================
-- 072_cl_01_legacy_cleanup.sql
-- CL-01: вычистка зомби-остатков от long-poll / wake-webhook эпохи.
--
-- Аудит (2026-09-03) подтвердил: колонки не имеют ни читателей, ни данных
-- (все NULL), маркеры deploy_notify/fix_notify никто не пишет (wait_for_tasks
-- удалён), папка edge-функции была пустой (удалялась на уровне FS).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Дроп зомби-колонок mcp_agent_keys
--    * webhook_url / webhook_secret — R5 wake-webhook (миг. 061), не реализован;
--      wake переведён на Realtime broadcast (071).
--    * key_plaintext — НЕ в миграциях репозитория (дрейф для `supabase db push`).
--    * agent_type — миг. 042, "nullable until UI step 2"; шаг не сделан никогда.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mcp_agent_keys
  DROP COLUMN IF EXISTS webhook_url,
  DROP COLUMN IF EXISTS webhook_secret,
  DROP COLUMN IF EXISTS key_plaintext,
  DROP COLUMN IF EXISTS agent_type;

COMMENT ON TABLE public.mcp_agent_keys IS
  'Agent API keys (1 key = 1 agent). Legacy webhook/key columns removed in CL-01; wake = Realtime broadcast (071), identity = key row only.';

-- ---------------------------------------------------------------------------
-- 2. Ужесточить agent_events_tool_check: убрать deploy_notify / fix_notify
--    (маркеры wait_for_tasks из миграции 050; инструмент и писатели удалены)
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_events
  DROP CONSTRAINT IF EXISTS agent_events_tool_check;

ALTER TABLE public.agent_events
  ADD CONSTRAINT agent_events_tool_check
  CHECK (tool = ANY (ARRAY[
    'create_task',
    'get_tasks_by_column',
    'get_workspace_settings',
    'get_task_context',
    'move_task',
    'escalate_task',
    'bot_command',
    'send_message_to_chat',
    'undo',
    'handoff_task',
    'ops_lease',
    'ops_heartbeat',
    'ops_terminal',
    'ops_ack',
    'ops_nack'
  ]));

COMMENT ON CONSTRAINT agent_events_tool_check ON public.agent_events IS
  '0.9: domain + ops tools. Legacy deploy_notify/fix_notify markers (wait_for_tasks, migration 050) removed in CL-01.';