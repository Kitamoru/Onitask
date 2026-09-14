-- ============================================================================
-- 085_review_twa_acl.sql
-- REV-01 TWA: поддержка review-решений из TWA (POST /api/tasks/[id]/review).
--
--   1. Индекс для быстрого выборки очереди "мои задачи на проверке"
--      (reviewer_id + created_at), используемой TaskViewEdit/ReviewDecisionBlock.
--   2. Индекс для backfill-очереди без назначенного ревьюера (creator review).
--
-- ACL на уровне RPC review_action (083) не меняем — проверка прав делается
-- в route POST /api/tasks/[id]/review (TS, через getActiveWorkerInWorkspace),
-- а review_action остаётся SECURITY DEFINER для двух каналов (бот + TWA).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Индекс: назначенные ревьюеры — их "на проверке"
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_review_reviewer_queue
  ON public.tasks (workspace_id, reviewer_id, created_at DESC)
  WHERE "column" = 'review' AND reviewer_id IS NOT NULL;

COMMENT ON INDEX idx_tasks_review_reviewer_queue IS
  'REV-01 TWA: очередь задач на проверке для назначенного ревьюера '
  '(WHERE column=review AND reviewer_id IS NOT NULL).';

-- ---------------------------------------------------------------------------
-- 2. Индекс: backfill-очередь (reviewer_id IS NULL)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_review_unassigned
  ON public.tasks (workspace_id, created_at DESC)
  WHERE "column" = 'review' AND reviewer_id IS NULL;

COMMENT ON INDEX idx_tasks_review_unassigned IS
  'REV-01 TWA: backfill-очередь задач на проверке без назначенного ревьюера '
  '(WHERE column=review AND reviewer_id IS NULL).';

-- ---------------------------------------------------------------------------
-- 3. target_column ENUM для task_submissions (уже расширен в 082) —
--    гарантируем наличие 'done' для review→done approve-трая (083 notify_task_review).
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.task_submissions.target_column IS
  'REV-01 TWA: целевая колонка сдачи (review|done). 083 notify_task_review читает '
  'submission.body_text как reason для карточки ревью.';
