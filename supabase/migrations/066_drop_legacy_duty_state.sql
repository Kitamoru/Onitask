-- ============================================================================
-- 066_drop_legacy_duty_state.sql
-- Architecture 0.9 ADR R3: hard cut старого duty-контура.
--
--   * DROP TABLE agent_duty_state — server-side long-poll память (CTX-01).
--     Единственный читатель/писатель — lib/domain/agent/waitForTasks.ts,
--     который удаляется в той же серии (wait_for_tasks → ops_lease).
--   * DROP мёртвого RPC resolve_agent_worker_id (миграция 024): 0 вызовов
--     в живом коде; app-level resolveAgentWorkerId (lib/shared/mcpAuth) —
--     единственная точка создания воркеров (INV-04).
--
-- Wait: новых RPC/таблиц не трогаем (060–065 уже создали ops-контур).
-- ============================================================================

DROP TABLE IF EXISTS public.agent_duty_state;

DROP FUNCTION IF EXISTS public.resolve_agent_worker_id(text, uuid);

COMMENT ON SCHEMA public IS 'Agent operability 0.9: lease/terminal/outbox active; long-poll duty state removed (ADR R3).';