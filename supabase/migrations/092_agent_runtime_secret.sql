-- ============================================================================
-- 092_agent_runtime_secret.sql
-- Stage 15 / DS-06: выделенный Bearer-секрет для вызова Edge Function agent-runtime.
--
-- Почему не vault.service_role_key (паттерн 041): smoke-тест поймал 401 на обоих
-- путях передачи — значение в Vault (legacy JWT) расходится с env функции
-- SUPABASE_SERVICE_ROLE_KEY (новый формат ключей). Плюс hex-секрет не является
-- JWT, поэтому у функции выключен verify_jwt (у неё своя timing-safe авторизация,
-- а вызовы делает только наша БД: push-триггер и cron-sweeper).
--
-- Повторяет проверенный паттерн bot-notify: секрет в Vault + RPC только service_role.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'agent_runtime_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'agent_runtime_secret',
      'Stage 15: Bearer-токен вызова Edge Function agent-runtime (push + sweeper).'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_agent_runtime_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'agent_runtime_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_agent_runtime_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_runtime_secret() TO service_role;

COMMENT ON FUNCTION public.get_agent_runtime_secret() IS
  'Stage 15: Bearer-секрет вызова Edge Function agent-runtime. Service-role only (acl как у get_bot_notify_cron_secret).';

-- ---------------------------------------------------------------------------
-- Push-триггер: подписывается выделенным секретом
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_agent_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  -- Только агенты с активным коннектором: pull-рантаймы (MCP/CLI) забирают работу сами.
  IF NOT public.agent_connector_active(NEW.workspace_id, NEW.agent_name) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := public.get_edge_fn_url() || '/agent-runtime',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(public.get_agent_runtime_secret(), '')
    ),
    body    := jsonb_build_object('mode', 'dispatch', 'outbox_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Push — только ускорение доставки: строка остаётся pending, её подберёт sweeper.
  UPDATE public.dispatch_outbox
  SET error = left('agent push failed: ' || SQLERRM, 500)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Sweeper: тот же секрет
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
      'Authorization', 'Bearer ' || COALESCE(public.get_agent_runtime_secret(), '')
    ),
    body    := '{"mode":"sweep"}'::jsonb
  );
  $$
);
