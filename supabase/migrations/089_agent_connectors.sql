-- ============================================================================
-- 089_agent_connectors.sql
-- Stage 15 / DS-01: реестр внешних агентов («Agent Connectors»).
--
-- Проблема: внешний агент сегодня обязан быть pull-рантаймом (MCP/CLI) — он сам
-- зовёт ops_lease. Кейс «добавить агента по endpoint + name + key, чтобы Onitask
-- сам прокинул задачу, проверил исполнение и забрал результат» требует серверного
-- рантайма, а для него нужен durable реестр подключений.
--
-- Что здесь:
--   1. agent_connectors — конфигурация подключения: endpoint, model, kind,
--      автономия, лимиты, allowlist MCP-инструментов, ссылка на секрет в Vault.
--   2. Vault-хелперы set/get/delete: plaintext ключа агента в таблице НЕ хранится
--      (INV-19) — только secret_ref (vault.secrets.id) + secret_hint.
--   3. agent_connector_active() — предикат для push-триггера и API-валидации.
--
-- Рантайм (agent_runs, push-триггер на dispatch_outbox, cron-sweeper, Edge
-- Function agent-runtime) добавляется миграцией 090 — чтобы push-триггер не
-- стрелял в ещё не задеплоенную функцию.
--
-- RLS: таблица service-only (политик нет) — тот же паттерн, что task_executions /
-- dispatch_outbox / agent_duty_state. Из UI доступ только через /api/agents
-- (initData + членство + роль), поля секрета наружу не уходят.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_connectors (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_name        text        NOT NULL,
  worker_id         uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  kind              text        NOT NULL DEFAULT 'openai_chat'
                                  CHECK (kind IN ('openai_chat', 'async_task', 'mcp_runtime')),
  base_url          text        NOT NULL,
  model             text,
  provider_version  text,
  auth_scheme       text        NOT NULL DEFAULT 'bearer'
                                  CHECK (auth_scheme IN ('bearer')),
  secret_ref        uuid,
  secret_hint       text,
  autonomy          text        NOT NULL DEFAULT 'tasks'
                                  CHECK (autonomy IN ('observer', 'tasks', 'full')),
  response_schema   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  skills            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  mcp_allowlist     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  limits            jsonb       NOT NULL DEFAULT
                                  '{"max_runs_per_day": 20, "max_run_seconds": 900}'::jsonb,
  is_active         boolean     NOT NULL DEFAULT true,
  is_paused         boolean     NOT NULL DEFAULT false,
  revoked_at        timestamptz,
  created_by        uuid        REFERENCES public.workers(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_connectors_base_url_https
    CHECK (base_url LIKE 'https://%'),
  CONSTRAINT agent_connectors_agent_name_len
    CHECK (char_length(agent_name) BETWEEN 1 AND 60)
);

-- Один активный коннектор на (workspace, agent_name) — та же семантика, что
-- uq_mcp_agent_keys_workspace_agent_active (061): 1 агент = 1 подключение.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_connectors_workspace_agent_active
  ON public.agent_connectors (workspace_id, agent_name)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_connectors_workspace
  ON public.agent_connectors (workspace_id, is_active);

-- Advisor-clean: покрывающие индексы для FK (паттерн 074)
CREATE INDEX IF NOT EXISTS idx_agent_connectors_worker_id
  ON public.agent_connectors (worker_id);

CREATE INDEX IF NOT EXISTS idx_agent_connectors_created_by
  ON public.agent_connectors (created_by);

DROP TRIGGER IF EXISTS trg_agent_connectors_updated_at ON public.agent_connectors;
CREATE TRIGGER trg_agent_connectors_updated_at
  BEFORE UPDATE ON public.agent_connectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agent_connectors ENABLE ROW LEVEL SECURITY;
-- RLS без политик = service-only (паттерн task_executions / dispatch_outbox).

COMMENT ON TABLE public.agent_connectors IS
  'Stage 15: внешние агенты (endpoint + key). Секрет — только в Vault (secret_ref, INV-19). Хостед-рантайм забирает работу через ops_lease; RLS service-only, доступ из UI — /api/agents.';

COMMENT ON COLUMN public.agent_connectors.secret_ref IS
  'vault.secrets.id с API-ключом агента. Plaintext никогда не читается клиентом (INV-19).';
COMMENT ON COLUMN public.agent_connectors.secret_hint IS
  'Маска ключа для UI: первые 4 + последние 4 символа (например dft_…el5l).';
COMMENT ON COLUMN public.agent_connectors.mcp_allowlist IS
  'Инструменты НАШЕГО /api/mcp, которые получает внешний агент при инъекции mcp_servers. Только read/comment — мутации запрещены (INV-18).';
COMMENT ON COLUMN public.agent_connectors.limits IS
  'jsonb: max_runs_per_day, max_run_seconds (<= lease 20 мин). Stop-cran UC-10.';
COMMENT ON COLUMN public.agent_connectors.autonomy IS
  'observer — работа не выдаётся (probe/read-only); tasks — прогоны + terminal(review); full — + деплой-политика после апрува.';

-- ---------------------------------------------------------------------------
-- 1. Предикат: есть ли активный коннектор под этого агента
--    Используется push-триггером (090) и API-валидацией: pull-рантаймы
--    (MCP/CLI) коннектора не имеют и продолжают работать как раньше.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_connector_active(
  p_workspace_id uuid,
  p_agent_name   text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agent_connectors c
    WHERE c.workspace_id = p_workspace_id
      AND c.agent_name   = p_agent_name
      AND c.revoked_at IS NULL
      AND c.is_active
      AND NOT c.is_paused
      AND c.autonomy <> 'observer'
  );
$$;

COMMENT ON FUNCTION public.agent_connector_active(uuid, text) IS
  'Stage 15: true, если для агента есть активный (не paused, не revoked, autonomy<>observer) коннектор — только тогда задачу тянет хостед-рантайм.';

-- ---------------------------------------------------------------------------
-- 2. Секреты (Vault). Plaintext ключа агента живёт только в vault.secrets;
--    в agent_connectors — ссылка + маска (INV-19).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_connector_set_secret(
  p_connector_id uuid,
  p_secret       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
DECLARE
  v_secret_id uuid;
  v_name      text;
  v_hint      text;
  v_result    uuid;
BEGIN
  IF p_secret IS NULL OR char_length(p_secret) < 8 THEN
    RAISE EXCEPTION 'agent_connector_set_secret: secret is too short';
  END IF;

  SELECT c.secret_ref INTO v_secret_id
  FROM public.agent_connectors c
  WHERE c.id = p_connector_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_connector_set_secret: connector % not found', p_connector_id;
  END IF;

  v_name := 'agent_connector_' || p_connector_id::text;

  IF v_secret_id IS NULL THEN
    v_result := vault.create_secret(p_secret, v_name, 'onitask agent connector key');
  ELSE
    v_result := vault.update_secret(v_secret_id, p_secret, v_name,
                                    'onitask agent connector key');
    -- Страховка: секрет могли удалить вручную — тогда создаём заново
    IF v_result IS NULL THEN
      v_result := vault.create_secret(p_secret, v_name, 'onitask agent connector key');
    END IF;
  END IF;

  v_hint := left(p_secret, 4) || '…' || right(p_secret, 4);

  UPDATE public.agent_connectors
  SET secret_ref  = v_result,
      secret_hint = v_hint
  WHERE id = p_connector_id;

  RETURN v_hint;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_connector_get_secret(
  p_connector_id uuid
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
  SELECT s.decrypted_secret
  FROM vault.decrypted_secrets s
  WHERE s.id = (
    SELECT c.secret_ref FROM public.agent_connectors c WHERE c.id = p_connector_id
  )
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.agent_connector_delete_secret(
  p_connector_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT c.secret_ref INTO v_secret_id
  FROM public.agent_connectors c
  WHERE c.id = p_connector_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  UPDATE public.agent_connectors
  SET secret_ref = NULL,
      secret_hint = NULL
  WHERE id = p_connector_id;
END;
$$;

-- Доступ к секретам — только service_role (acl как у get_bot_notify_cron_secret)
REVOKE ALL ON FUNCTION public.agent_connector_set_secret(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_connector_get_secret(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_connector_delete_secret(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_connector_active(uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent_connector_set_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_connector_get_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_connector_delete_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_connector_active(uuid, text) TO service_role;
