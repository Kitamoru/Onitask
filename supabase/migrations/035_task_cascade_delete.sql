-- ============================================================
-- onitask · Task cascade delete support
-- File:    035_task_cascade_delete.sql
-- Purpose: Ensure all task-related tables have ON DELETE CASCADE
--          so that deleting a task removes all related data.
-- Date:    2026-08-19
-- ============================================================

-- Add ON DELETE CASCADE to task_relations (source_task_id)
ALTER TABLE public.task_relations
  DROP CONSTRAINT IF EXISTS task_relations_source_task_id_fkey;

ALTER TABLE public.task_relations
  ADD CONSTRAINT task_relations_source_task_id_fkey
    FOREIGN KEY (source_task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- Add ON DELETE CASCADE to task_relations (target_task_id)
ALTER TABLE public.task_relations
  DROP CONSTRAINT IF EXISTS task_relations_target_task_id_fkey;

ALTER TABLE public.task_relations
  ADD CONSTRAINT task_relations_target_task_id_fkey
    FOREIGN KEY (target_task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- Add ON DELETE CASCADE to task_column_history
ALTER TABLE public.task_column_history
  DROP CONSTRAINT IF EXISTS task_column_history_task_id_fkey;

ALTER TABLE public.task_column_history
  ADD CONSTRAINT task_column_history_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- Add ON DELETE CASCADE to assignment_history
ALTER TABLE public.assignment_history
  DROP CONSTRAINT IF EXISTS assignment_history_task_id_fkey;

ALTER TABLE public.assignment_history
  ADD CONSTRAINT assignment_history_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- Add ON DELETE CASCADE to enrichments
ALTER TABLE public.enrichments
  DROP CONSTRAINT IF EXISTS enrichments_task_id_fkey;

ALTER TABLE public.enrichments
  ADD CONSTRAINT enrichments_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- Add ON DELETE CASCADE to task_vector_chunks
ALTER TABLE public.task_vector_chunks
  DROP CONSTRAINT IF EXISTS task_vector_chunks_task_id_fkey;

ALTER TABLE public.task_vector_chunks
  ADD CONSTRAINT task_vector_chunks_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;

-- Add ON DELETE CASCADE to bot_task_drafts
ALTER TABLE public.bot_task_drafts
  DROP CONSTRAINT IF EXISTS bot_task_drafts_task_id_fkey;

ALTER TABLE public.bot_task_drafts
  ADD CONSTRAINT bot_task_drafts_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks(id)
    ON DELETE CASCADE;