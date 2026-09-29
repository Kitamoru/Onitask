-- ============================================================================
-- 138_agent_events_reaper_tool.sql
-- Репёр не мог освобождать просроченные лизы — из-за этого задача залипала
-- навсегда после любого упавшего терминала.
--
-- Кейс (ONIT-43, 2026-09-28). Два прогона агента упали на
-- ops_terminal («column w.agent_name does not exist», ошибка из 137). Рантайм
-- записал agent_run_failed, но лиза осталась живой, задача осталась в
-- in_progress с active_claim_id, и новый запуск не мог взять задачу.
--
-- Почему не разрулил репёр (cron ops-reaper-tick, раз в минуту):
--   ops_reaper_tick вставляет в agent_events строку с tool = 'ops_reaper',
--   а agent_events_tool_check такого значения не содержал. CHECK отклонял
--   вставку, исключение катило на всю партию — цикл откатывался, и НИ ОДНА
--   просроченная лиза не освобождалась. Крон падал одинаково каждую минуту,
--   тихо, потому что pg_cron не рассылает алертов.
--
-- Проверено перед правкой: literaly tool, которые реально пишут функции и
-- рантайм — ops_lease, ops_heartbeat, ops_terminal, ops_ack, ops_nack,
-- ops_reaper, agent_run_submitted, agent_run_collected, agent_run_failed.
-- Отсутствовал ровно один: ops_reaper.
--
-- Миграция 137 этот список переписывала целиком и унаследовала omission —
-- ограничение чинили частично, список копировали. Здесь список дополнен.
--
-- ВАЖНО ПРИ ЧТЕНИЕМ/ПРАВКЕ ЭТОГО ФАЙЛА. agent_events_tool_check — это
-- копирование перечисления, а не ссылка на источник. Поэтому новый
-- tool обязан попасть в СПИСОК ЗДЕСЬ (это последний файл, который его
-- переписывает) — 137 сознательно НЕ правим: он уже применён, и правка
-- задним числом создала бы расхождение между файлом и живой схемой.
--
-- Почему список копируется, а не выносится в справочник: справочник
-- потребовал бы ещё одной миграции, а выигрыш — три строки, которые всё
-- равно пишутся руками. Осознанная плата за простоту: ошибка в этом
-- перечислении молча откатывает партию вызовов (именно так вчера упал
-- ops_reaper-tick). Если список разрастётся — тогда и рефакторинг.
-- Перед применением: SELECT unnest(...) из pg_constraint, а не глазами.
-- ============================================================================

BEGIN;

ALTER TABLE public.agent_events DROP CONSTRAINT IF EXISTS agent_events_tool_check;

ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_tool_check
  CHECK (tool = ANY (ARRAY[
    'create_task', 'get_tasks_by_column', 'get_workspace_settings', 'get_task_context',
    'move_task', 'escalate_task', 'bot_command', 'send_message_to_chat', 'undo',
    'handoff_task',
    'ops_lease', 'ops_heartbeat', 'ops_terminal', 'ops_ack', 'ops_nack', 'ops_reaper',
    'agent_run_submitted', 'agent_run_collected', 'agent_run_failed',
    'agent_attachments_dropped'
  ]::text[]));

COMMENT ON COLUMN public.agent_events.tool IS
  'Имя инструмента/события. agent_attachments_dropped добавлен в 137, ops_reaper — в 138: без него репёр падал на каждой просроченной лизе.';

COMMIT;
