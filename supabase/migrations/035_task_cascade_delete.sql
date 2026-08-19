-- ============================================================
-- onitask · Task cascade delete support
-- File:    035_task_cascade_delete.sql
-- Purpose: Ensure all task-related tables have ON DELETE CASCADE
--          so that deleting a task removes all related data.
-- Date:    2026-08-19
-- ============================================================

-- 1. agent_events: change task_id FK from SET NULL to CASCADE
ALTER TABLE public.agent_events
  DROP CONSTRAINT agent_events_task_id_fkey;

ALTER TABLE public.agent_events
  ADD CONSTRAINT agent_events_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- 2. assignment_history: change task_id FK from SET NULL to CASCADE
ALTER TABLE public.assignment_history
  DROP CONSTRAINT assignment_history_task_id_fkey;

ALTER TABLE public.assignment_history
  ADD CONSTRAINT assignment_history_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- NOTE: The following tables already have correct CASCADE constraints:
--   - agent_memory (task_id → tasks.id ON DELETE CASCADE)
--   - task_column_history (task_id → tasks.id ON DELETE CASCADE)
--   - task_enrichments (task_id → tasks.id ON DELETE CASCADE)
--   - task_events (task_id → tasks.id ON DELETE CASCADE)
--   - task_relations (from_task_id → tasks.id ON DELETE CASCADE)
--   - task_relations (to_task_id → tasks.id ON DELETE CASCADE)