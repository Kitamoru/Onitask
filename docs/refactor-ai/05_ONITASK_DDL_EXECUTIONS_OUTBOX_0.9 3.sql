-- onitask · DDL 0.9 — task_executions + dispatch outbox
-- Apply after mcp_agent_keys / tasks baseline exist.
-- Postgres / Supabase

-- ---------------------------------------------------------------------------
-- task_executions: ownership of one attempt to perform work
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_executions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_name        text NOT NULL,
  runtime_id        uuid NOT NULL,
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed', 'expired')),
  attempt           int  NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  claimed_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  heartbeat_at      timestamptz,
  terminal_outcome  text
                      CHECK (terminal_outcome IS NULL
                             OR terminal_outcome IN ('review', 'escalate', 'handoff')),
  summary           text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_executions_task
  ON public.task_executions (task_id);

CREATE INDEX IF NOT EXISTS idx_task_executions_workspace_status
  ON public.task_executions (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_task_executions_open_expires
  ON public.task_executions (expires_at)
  WHERE status = 'open';

-- At most one open execution per task
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_executions_one_open_per_task
  ON public.task_executions (task_id)
  WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- tasks.active_claim_id pointer
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS active_claim_id uuid
    REFERENCES public.task_executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_active_claim
  ON public.tasks (active_claim_id)
  WHERE active_claim_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- dispatch_outbox: transactional boundary domain → delivery
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  agent_name      text NOT NULL,
  attempt         int  NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'published', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  error           text
);

CREATE INDEX IF NOT EXISTS idx_dispatch_outbox_pending
  ON public.dispatch_outbox (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_dispatch_outbox_agent
  ON public.dispatch_outbox (workspace_id, agent_name, status);

-- ---------------------------------------------------------------------------
-- Optional: delivery receipts for ack (if not using pgmq native msg id only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_receipts (
  receipt         text PRIMARY KEY,
  execution_id    uuid NOT NULL REFERENCES public.task_executions(id) ON DELETE CASCADE,
  outbox_id       uuid REFERENCES public.dispatch_outbox(id) ON DELETE SET NULL,
  workspace_id    uuid NOT NULL,
  acked_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_receipts_execution
  ON public.dispatch_receipts (execution_id);

-- ---------------------------------------------------------------------------
-- Workspace / platform execution policy (optional columns)
-- ---------------------------------------------------------------------------
-- ALTER TABLE public.workspace_settings
--   ADD COLUMN IF NOT EXISTS max_execution_attempts int NOT NULL DEFAULT 3,
--   ADD COLUMN IF NOT EXISTS lease_vt_seconds int NOT NULL DEFAULT 1200;

COMMENT ON TABLE public.task_executions IS 'Agent execution ownership; fencing via id + runtime_id + status';
COMMENT ON TABLE public.dispatch_outbox IS 'Transactional outbox for agent dispatch; publisher → pgmq or table lease';


-- ---------------------------------------------------------------------------
-- 0.9 FINAL additions (ADR R3, R8)
-- ---------------------------------------------------------------------------

-- Drop legacy duty long-poll state (no production clients)
-- DROP TABLE IF EXISTS public.agent_duty_state;

-- Human pre-empt: force-close open execution when task column changes
-- outside ops_terminal path. Implementation sketch:
--
-- Use session variable set by ops handlers, e.g.:
--   SELECT set_config('onitask.ops_mutation', '1', true);
-- Trigger skips when current_setting('onitask.ops_mutation', true) = '1'.
--
-- CREATE OR REPLACE FUNCTION public.trg_tasks_human_override_claim()
-- RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--   IF NEW.active_claim_id IS NULL THEN
--     RETURN NEW;
--   END IF;
--   IF current_setting('onitask.ops_mutation', true) = '1' THEN
--     RETURN NEW;
--   END IF;
--   IF NEW.column IS DISTINCT FROM OLD.column THEN
--     UPDATE public.task_executions
--       SET status = 'closed',
--           terminal_outcome = NULL,
--           summary = coalesce(summary, '') || ' [human_override]',
--           closed_at = now(),
--           metadata = metadata || jsonb_build_object('close_reason', 'human_override')
--       WHERE id = NEW.active_claim_id AND status = 'open';
--     NEW.active_claim_id := NULL;
--     NEW.version := OLD.version + 1;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- CREATE TRIGGER tasks_human_override_claim
--   BEFORE UPDATE ON public.tasks
--   FOR EACH ROW
--   EXECUTE FUNCTION public.trg_tasks_human_override_claim();

-- Optional on mcp_agent_keys (ADR R2):
-- ALTER TABLE public.mcp_agent_keys
--   ADD COLUMN IF NOT EXISTS webhook_url text,
--   ADD COLUMN IF NOT EXISTS webhook_secret text;
