-- ============================================================================
-- 061_agent_key_identity.sql
-- Architecture 0.9 ADR R2: 1 mcp_agent_key = 1 агент.
--
-- Проблема: identity сегодня передаётся в каждом вызове (agent_name в теле,
-- X-Agent-Name). Это dual-SoT на «кто вызывает». 0.9 фиксирует identity в КЛЮЧЕ.
--
-- Решение (по решению владельца):
--   1) Все существующие ключи РЕВОЦИРУЮТСЯ (revoked_at = now()) — клиенты-тестеры
--      перевыпускают ключи через UI с явным agent_name. Никакого backfill по
--      agent_events, никакого «ленивого биндинга» — переход жёсткий и простой.
--   2) mcp_agent_keys.agent_name text NOT NULL — каноническая identity.
--   3) UNIQUE (workspace_id, agent_name) для активных ключей: на воркспейс
--      максимум один ключ на агента (1 key = 1 agent).
--   4) webhook_url / webhook_secret — R5 wake-колонки (фаза 2, но схему делаем
--      сразу, чтобы фаза 2 была чисто кодовой).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ревокация всех существующих ключей (hard cut по желанию владельца)
-- ---------------------------------------------------------------------------
UPDATE public.mcp_agent_keys
SET revoked_at = coalesce(revoked_at, now())
WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. agent_name — каноническая identity ключа
-- ---------------------------------------------------------------------------
ALTER TABLE public.mcp_agent_keys
  ADD COLUMN IF NOT EXISTS agent_name text;

-- Больше ни один ключ не может остаться без identity. Ревокнутые строки
-- получают label как информационный placeholder (они уже нерабочие).
UPDATE public.mcp_agent_keys
SET agent_name = label
WHERE agent_name IS NULL;

ALTER TABLE public.mcp_agent_keys
  ALTER COLUMN agent_name SET NOT NULL;

COMMENT ON COLUMN public.mcp_agent_keys.agent_name IS
  'Arch 0.9 ADR R2: canonical agent identity for the key (1 key = 1 agent). Client-provided names must match; mismatch → 403.';

-- ---------------------------------------------------------------------------
-- 3. Unique: один активный ключ на (workspace, agent)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_agent_keys_workspace_agent_active
  ON public.mcp_agent_keys (workspace_id, agent_name)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. R5 wake webhook columns (хранение сразу; фаза 2 — кодовый эмиттер)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mcp_agent_keys
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_secret text;

COMMENT ON COLUMN public.mcp_agent_keys.webhook_url IS
  'Optional agent wake webhook URL (outbound, work.available). Does NOT grant work — runtime must ops_lease.';
COMMENT ON COLUMN public.mcp_agent_keys.webhook_secret IS
  'HMAC secret for the wake webhook payload. Never returned to clients.';