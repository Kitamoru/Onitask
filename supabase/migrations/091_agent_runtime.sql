-- ============================================================================
-- 091_agent_runtime.sql
-- Stage 15 / DS-04: рантайм хостед-агентов (вариант A — Onitask-as-Runtime).
--
-- Что здесь:
--   1. agent_runs — журнал прогонов «прокинул → проверил → забрал»: идемпотентность
--      (UNIQUE execution_id), resumable-поллинг (next_poll_at), телеметрия
--      стоимости (usage) и аудит egress (request_digest). Секретов в дайджестах нет.
--   2. agent_events: новые маркеры агентского рантайма.
--   3. trg_agent_dispatch_push — pg_net push в Edge Function `agent-runtime`
--      (латентность ~секунды вместо ожидания тика). Проверяет только агентов
--      с активным коннектором: pull-рантаймы (MCP/CLI) работают как раньше.
--   4. cron `agent-runtime-sweep` (раз в 30 с) — sweeper: потерянные push,
--      продолжение resumable-прогонов, подбор «зависших».
--   5. agent_runtime_pending() / agent_runs_due() — выборки для рантайма.
--
-- Рантайм вызывает ops_lease/ops_heartbeat/ops_terminal/ops_ack напрямую
-- (все они доступны только service_role) — то есть серверный runtime
-- подчиняется тому же контракту, что внешний: fencing, CAS, receipts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id    uuid        NOT NULL REFERENCES public.agent_connectors(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  execution_id    uuid        NOT NULL REFERENCES public.task_executions(id) ON DELETE CASCADE,
  task_id         uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- fencing: тот же runtime_id при resume, иначе ops_terminal отвергнет (stale_claim)
  runtime_id      uuid        NOT NULL,
  attempt         int         NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status          text        NOT NULL DEFAULT 'submitted'
                                CHECK (status IN ('submitted', 'running', 'collected', 'failed', 'cancelled')),
  provider_run_id text,
  next_poll_at    timestamptz,
  request_digest  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  response_digest jsonb,
  usage           jsonb,
  error_code      text,
  error_text      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Одна попытка = одна строка: повторный тик не создаёт дубль прогона.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_execution
  ON public.agent_runs (execution_id);

-- Resumable: выборка «пора дочитать результат».
CREATE INDEX IF NOT EXISTS idx_agent_runs_due
  ON public.agent_runs (next_poll_at)
  WHERE status IN ('submitted', 'running');

CREATE INDEX IF NOT EXISTS idx_agent_runs_connector
  ON public.agent_runs (connector_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_runs_task
  ON public.agent_runs (task_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace
  ON public.agent_runs (workspace_id, status);

DROP TRIGGER IF EXISTS trg_agent_runs_updated_at ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
-- RLS без политик = service-only (паттерн task_executions / dispatch_outbox).

COMMENT ON TABLE public.agent_runs IS
  'Stage 15: журнал прогонов хостед-агента. Идемпотентность по execution_id, resumable через next_poll_at, стоимость в usage, аудит egress в request_digest (без секретов). RLS service-only.';

COMMENT ON COLUMN public.agent_runs.runtime_id IS
  'Fencing: обязан совпадать с runtime_id execution. Сохраняется здесь, чтобы продолжение прогона в следующем тике (новом вызове функции) не потеряло владение.';

-- ---------------------------------------------------------------------------
-- 2. agent_events: маркеры рантайма
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_events DROP CONSTRAINT IF EXISTS agent_events_tool_check;
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
    'ops_nack',
    'agent_run_submitted',
    'agent_run_collected',
    'agent_run_failed'
  ]));

COMMENT ON CONSTRAINT agent_events_tool_check ON public.agent_events IS
  '0.9 + Stage 15: domain + ops tools + маркеры хостед-рантайма (agent_run_*).';

-- ---------------------------------------------------------------------------
-- 3. Push: dispatch_outbox → Edge Function agent-runtime
--    Латентность ~секунды; при сбое строка остаётся pending (sweeper подберёт).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_agent_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_key text;
BEGIN
  -- Только агенты с активным коннектором: pull-рантаймы (MCP/CLI) забирают работу сами.
  IF NOT public.agent_connector_active(NEW.workspace_id, NEW.agent_name) THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  PERFORM net.http_post(
    url     := public.get_edge_fn_url() || '/agent-runtime',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_key, '')
    ),
    body    := jsonb_build_object('mode', 'dispatch', 'outbox_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Push — только ускорение доставки: строка остаётся pending.
  UPDATE public.dispatch_outbox
  SET error = left('agent push failed: ' || SQLERRM, 500)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_agent_dispatch_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_agent_dispatch_push() TO service_role;

DROP TRIGGER IF EXISTS trg_agent_dispatch_push ON public.dispatch_outbox;
CREATE TRIGGER trg_agent_dispatch_push
  AFTER INSERT ON public.dispatch_outbox
  FOR EACH ROW EXECUTE FUNCTION public.trg_agent_dispatch_push();

-- ---------------------------------------------------------------------------
-- 4. Выборки для рантайма
-- ---------------------------------------------------------------------------

-- Кандидаты на выдачу: pending outbox + активный коннектор + задача без открытого
-- execution (последнее — доп. фильтр, чтобы не дёргать ops_lease впустую).
CREATE OR REPLACE FUNCTION public.agent_runtime_pending(p_limit int DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT o.id AS outbox_id, o.workspace_id, o.agent_name, o.task_id,
           o.attempt, c.id AS connector_id, c.autonomy, c.kind, c.model,
           c.base_url, c.limits, c.mcp_allowlist, c.skills
    FROM public.dispatch_outbox o
    JOIN public.agent_connectors c
      ON c.workspace_id = o.workspace_id
     AND c.agent_name   = o.agent_name
    WHERE o.status = 'pending'
      AND c.revoked_at IS NULL
      AND c.is_active
      AND NOT c.is_paused
      AND c.autonomy <> 'observer'
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks tk
        WHERE tk.id = o.task_id AND tk.active_claim_id IS NOT NULL
      )
    ORDER BY o.created_at
    LIMIT GREATEST(p_limit, 1)
  ) t;
$$;

-- Прогоны, которые надо дочитать/продолжить (resumable: сбой в середине прогона
-- не теряет результат — database остаётся источником истины).
CREATE OR REPLACE FUNCTION public.agent_runs_due(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT r.id AS run_id, r.connector_id, r.workspace_id, r.execution_id, r.task_id,
           r.runtime_id, r.status, r.attempt, r.provider_run_id, r.next_poll_at,
           r.request_digest, c.agent_name, c.kind, c.model, c.base_url, c.limits,
           c.mcp_allowlist, c.skills
    FROM public.agent_runs r
    JOIN public.agent_connectors c ON c.id = r.connector_id
    WHERE r.status IN ('submitted', 'running')
      AND (r.next_poll_at IS NULL OR r.next_poll_at <= now())
    ORDER BY r.started_at
    LIMIT GREATEST(p_limit, 1)
  ) t;
$$;

REVOKE ALL ON FUNCTION public.agent_runtime_pending(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_runs_due(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_runtime_pending(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_runs_due(int) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Sweeper: раз в 30 секунд добирает потерянные push и resumable-прогоны
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('agent-runtime-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-runtime-sweep');

SELECT cron.schedule(
  'agent-runtime-sweep',
  '30 seconds',
  $$
  SELECT net.http_post(
    url     := public.get_edge_fn_url() || '/agent-runtime',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'service_role_key' LIMIT 1
      )
    ),
    body    := '{"mode":"sweep"}'::jsonb
  );
  $$
);
