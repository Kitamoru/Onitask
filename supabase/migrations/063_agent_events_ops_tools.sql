-- ============================================================================
-- 063_agent_events_ops_tools.sql
-- Architecture 0.9: CHECK(agent_events.tool) расширяется на ops-инструменты.
--
-- Проблема: ops_terminal/ops_nack пишут audit-события (reason source для
-- bot-notify, G7), но CHECK, созданный базово (миграции 024/050), их не
-- допускал → terminal падал с 23514.
-- Паттерн тот же, что в 050 (deploy_notify/fix_notify): DROP + CREATE CHECK.
-- ============================================================================

ALTER TABLE public.agent_events
  DROP CONSTRAINT IF EXISTS agent_events_tool_check;

ALTER TABLE public.agent_events
  ADD CONSTRAINT agent_events_tool_check
  CHECK (tool IN (
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
    'deploy_notify',
    'fix_notify',
    'ops_lease',
    'ops_heartbeat',
    'ops_terminal',
    'ops_ack',
    'ops_nack'
  ));

COMMENT ON CONSTRAINT agent_events_tool_check ON public.agent_events IS
  '0.9: ops_* tools allowed for audit + bot-notify reason resolution (G7).';