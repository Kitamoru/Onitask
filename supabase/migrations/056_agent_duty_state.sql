-- ============================================================================
-- Migration 056: agent_duty_state — server-side duty-loop memory (CTX-01).
--
-- Проблема: дежурный цикл гонял растущий список known_task_ids через каждый
--   poll-вызов wait_for_tasks — контекст LLM-сессии раздувался линейно, и
--   каждый Auto Compact разрушал состояние (нужна была дорогая реконструкция).
-- Решение: сервер сам помнит доставленные агенту задачи, ключом служит
--   аутентифицированная идентичность (workspace_id + agent_name из Bearer-
--   ключа). Клиентский payload становится константным
--   ({timeout_sec, poll_seq}); после компакта следующий «голый» вызов находит
--   то же состояние — восстановление не требуется.
-- Semantics: запись seen ставится в момент доставки задачи в ответе
--   (persist до возврата ответа ⇒ при сбое at-least-once повторная доставка,
--   как у маркеров deploy_notify/fix_notify из миграции 050). TTL записей
--   (visibility timeout, 4ч) и cap размера поддерживаются кодом
--   (lib/domain/agent/waitForTasks.ts); здесь только хранение.
-- Доступ: RLS без политик = только service-role (прецедент
--   bot_review_fix_pending, миграция 051). Вне квот агентов.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_duty_state (
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_name   text        NOT NULL,
  -- Массив [{id: <task uuid>, ts: <delivery epoch ms>}] — см. WAITORTASKS-код.
  seen         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_name),
  CONSTRAINT agent_duty_state_seen_check CHECK (jsonb_typeof(seen) = 'array')
);

ALTER TABLE public.agent_duty_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_duty_state IS
  'CTX-01: per-agent duty-loop memory for wait_for_tasks. seen = delivered task ids with delivery timestamps (visibility TTL enforced in code). Service-only (RLS, no policies).';