-- ============================================================================
-- 072_wake_channel_by_agent_name.sql
-- Change Realtime wake channel from agent:<agent_key_id> to agent:<agent_name>.
--
-- Problem: agent_key_id (mcp_agent_keys.id) changes when the agent's API key
-- is regenerated. Since the wake channel was based on this id, a key rotation
-- caused the agent to subscribe to a different channel and miss wake events.
--
-- Fix: base the channel on agent_name instead — it is stable (unique per
-- workspace, enforced by uq_mcp_agent_keys_workspace_agent_active) and
-- already present in every dispatch_outbox row. This also removes the
-- JOIN with mcp_agent_keys in ops_publisher_tick.
--
-- Consistent with whoami returning identity only (no agent_key_id).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ops_publisher_tick — channel = 'agent:' || agent_name (no JOIN needed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_publisher_tick(p_batch int DEFAULT 100)
RETURNS void
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  rec        RECORD;
  v_payload  jsonb;
  v_channel  text;
BEGIN
  FOR rec IN
    SELECT o.id, o.workspace_id, o.agent_name, o.created_at
    FROM public.dispatch_outbox o
    WHERE o.status = 'pending'
      AND o.wake_sent_at IS NULL
    ORDER BY o.created_at
    LIMIT p_batch
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    v_channel := 'agent:' || rec.agent_name;
    v_payload := jsonb_build_object(
      'event_id',     rec.id::text,
      'type',         'work.available',
      'workspace_id', rec.workspace_id::text,
      'agent_name',   rec.agent_name,
      'ts',           now()::text
    );

    BEGIN
      -- Public channel: private := false explicitly (realtime.send default is true).
      PERFORM realtime.send(v_payload, 'work.available', v_channel, false);

      UPDATE public.dispatch_outbox
      SET wake_sent_at = now()
      WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      -- Failure does not degrade delivery: row stays 'pending'
      -- (picked up by next tick or ops_lease). Logged in error column.
      UPDATE public.dispatch_outbox
      SET error = left('wake broadcast failed: ' || SQLERRM, 500)
      WHERE id = rec.id;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ops_publisher_tick IS
  '0.9 wake: drains pending outbox rows (SKIP LOCKED, batch) → realtime.send on public channel agent:<agent_name>. Sets wake_sent_at on success; never touches status/published_at (lease path). Failure → error column only.';

-- ---------------------------------------------------------------------------
-- 2. Backfill: clear wake_sent_at for pending rows so they rebroadcast on the
--    new channel name (id-based channels will never receive a message now).
-- ---------------------------------------------------------------------------
UPDATE public.dispatch_outbox
SET wake_sent_at = NULL
WHERE status = 'pending' AND wake_sent_at IS NOT NULL;
