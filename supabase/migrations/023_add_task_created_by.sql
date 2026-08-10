-- Migration 023: Add created_by to tasks
-- Purpose: Track who created the task (постановщик задачи).
--          Required for stream view showing creator's drafts.

-- 1. Add column
ALTER TABLE public.tasks
  ADD COLUMN created_by uuid REFERENCES public.workers(id) ON DELETE SET NULL;

-- 2. Add index for queries by creator
CREATE INDEX idx_tasks_created_by ON public.tasks (created_by);

-- 3. Add comment
COMMENT ON COLUMN public.tasks.created_by IS 'Worker who created the task (постановщик). Set automatically by API on task creation.';