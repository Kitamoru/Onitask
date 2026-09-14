-- ============================================================================
-- 082_task_submissions.sql
-- onitask · SUBMIT-01: шаг «Результат» — фиксация сдачи при переходе
-- в review / done (флоу «закончил → приложил результат → отдал на проверку»).
--
-- Что добавляется:
--   1. task_submissions   — артефакт сдачи: кто, когда, что сделано (текст),
--                           ссылки, целевая колонка, статус.
--   2. task_attachments.submission_id — связь файлов со сдачей. Файлы живут
--                           в существующем bucket task-attachments (077);
--                           вложение без submission — обычный файл задачи.
--   3. RPC submit_task    — атомарная сдача: INSERT submission → привязка
--                           файлов → UPDATE tasks.column. Триггеры той же TX
--                           (trg_record_task_column_move 001, trg_bump_task_version
--                           046, review_state_check 049, notify 055/064/048)
--                           отрабатывают сами — доп. emit не нужен (паттерн 064).
--
-- Семантика (согласовано):
--   - review→done с неизменённым текстом (p_edited=false) → апрув последней
--     сдачи (status='accepted', accepted_by/at) БЕЗ дубля в истории.
--   - review→done с правкой → новая submission со status='accepted'.
--   - in_progress→done (мимо review) → submission со status='accepted'.
--   - Обратные/боковые переходы (в backlog/in_progress) — через PATCH без сдачи.
--   - Guard 049 (review_pending без reviewer) реплицирован из PATCH /api/tasks/[id]:
--     done без Telegram-апрува — только owner/admin/creator (флаг снимается
--     тем же UPDATE), остальным — review_approval_required.
--
-- RLS: task_submissions — SELECT для членов воркспейса (паттерн 077);
--      запись — только через RPC (EXECUTE выдан только service_role:
--      маршрут /api/tasks/[id]/submit резолвит профиль из Telegram initData
--      и передаёт p_profile_id доверенно). Каскады от tasks — ON DELETE CASCADE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. task_submissions — артефакт сдачи
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id        uuid        NOT NULL REFERENCES public.tasks(id)      ON DELETE CASCADE,
  submitted_by   uuid        NOT NULL REFERENCES public.workers(id),
  body_text      text        NOT NULL DEFAULT '' CHECK (char_length(body_text) <= 5000),
  -- [{label, url}] — ExternalLinksCard-совместимый формат (без отдельной таблицы)
  links          jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
  -- Целевая колонка этой сдачи (from-колонку не храним: восстанавливается
  -- по task_column_history, INV-03 — без денормализации)
  target_column  text        NOT NULL CHECK (target_column IN ('review', 'done')),
  -- submitted = ждёт проверки; accepted = принят (ревьюером или сразу в done)
  status         text        NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted')),
  accepted_by    uuid        REFERENCES public.workers(id),
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_submissions IS
  'SUBMIT-01: артефакт сдачи задачи (review/done). Текст + ссылки + связанные файлы (task_attachments.submission_id). История сдач иммутабельна: повторная сдача = новая строка; апрув без правки текста = UPDATE status последней сдачи.';

CREATE INDEX IF NOT EXISTS idx_task_submissions_task
  ON public.task_submissions (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_submissions_workspace
  ON public.task_submissions (workspace_id);

ALTER TABLE public.task_submissions ENABLE ROW LEVEL SECURITY;

-- Чтение — активные члены воркспейса задачи (паттерн task_attachments 077).
-- Запись (INSERT/UPDATE) — только service role: RPC submit_task + сервисные пути.
CREATE POLICY task_submissions_select_member
  ON public.task_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workers w
      WHERE w.workspace_id = task_submissions.workspace_id
        AND w.is_active = true
        AND w.source_id::text = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------------
-- 2. task_attachments.submission_id — связь файла со сдачей
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS submission_id uuid
    REFERENCES public.task_submissions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.task_attachments.submission_id IS
  'SUBMIT-01: файл приложен к сдаче (task_submissions). NULL = обычное вложение задачи без привязки к сдаче.';

CREATE INDEX IF NOT EXISTS idx_task_attachments_submission
  ON public.task_attachments (submission_id)
  WHERE submission_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RPC submit_task — атомарная сдача
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_task(
  p_task_id uuid,
  p_profile_id uuid,          -- профиль из Telegram initData (доверенный путь через маршрут)
  p_target_column text,
  p_body_text text,
  p_links jsonb DEFAULT '[]'::jsonb,
  p_attachment_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_expected_version integer DEFAULT NULL,  -- NULL → last-write-wins (INV-09, TWA)
  p_edited boolean DEFAULT true             -- false = текст исполнителя не правился (апрув)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task          public.tasks;
  v_worker        public.workers;
  v_submission_id uuid;
  v_reuse_id      uuid;
  v_status        text;
  v_new_version   integer;
BEGIN
  -- Задача
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;

  -- Активный human-работник в workspace задачи (INV-01/03: ссылки на workers(id))
  SELECT * INTO v_worker FROM public.workers
   WHERE workspace_id = v_task.workspace_id
     AND source_id::text = p_profile_id::text
     AND type = 'human'
     AND is_active = true
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  -- Валидация перехода
  IF p_target_column NOT IN ('review', 'done') THEN
    RAISE EXCEPTION 'invalid_target_column';
  END IF;
  IF v_task."column" = p_target_column THEN
    RAISE EXCEPTION 'same_column';
  END IF;

  -- INV-09: expected_version — строгий CAS; NULL → last-write-wins
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_task.version THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;

  -- Guard review_state_check (049), реплика PATCH-маршрута: review→done без
  -- reviewer при выставленном review_pending — только owner/admin/creator,
  -- флаг снимается тем же UPDATE (см. шаг ниже)
  IF p_target_column = 'done'
     AND v_task."column" = 'review'
     AND v_task.reviewer_id IS NULL
     AND COALESCE(v_task.metadata->>'review_pending', 'false') = 'true' THEN
    IF v_worker.id IS DISTINCT FROM v_task.created_by
       AND v_worker.role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'review_approval_required' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Approve-prefill: review→done без правки текста → апрув последней сдачи
  -- (без дубля строки в истории)
  v_reuse_id := NULL;
  IF p_target_column = 'done'
     AND v_task."column" = 'review'
     AND COALESCE(p_edited, true) = false THEN
    SELECT s.id INTO v_reuse_id
      FROM public.task_submissions s
     WHERE s.task_id = p_task_id
     ORDER BY s.created_at DESC
     LIMIT 1;
  END IF;

  IF v_reuse_id IS NOT NULL THEN
    UPDATE public.task_submissions
       SET status      = 'accepted',
           accepted_by = v_worker.id,
           accepted_at = now()
     WHERE id = v_reuse_id;
    v_submission_id := v_reuse_id;
  ELSE
    v_status := CASE WHEN p_target_column = 'done' THEN 'accepted' ELSE 'submitted' END;
    INSERT INTO public.task_submissions
      (workspace_id, task_id, submitted_by, body_text, links, target_column,
       status, accepted_by, accepted_at)
    VALUES
      (v_task.workspace_id, p_task_id, v_worker.id,
       COALESCE(left(p_body_text, 5000), ''),
       COALESCE(p_links, '[]'::jsonb),
       p_target_column,
       v_status,
       CASE WHEN p_target_column = 'done' THEN v_worker.id END,
       CASE WHEN p_target_column = 'done' THEN now() END)
    RETURNING id INTO v_submission_id;
  END IF;

  -- Привязка файлов сдачи (только вложения этой задачи; чужие id молча
  -- игнорируются — привязать вложение чужой задачи невозможно по WHERE)
  IF array_length(p_attachment_ids, 1) > 0 THEN
    UPDATE public.task_attachments
       SET submission_id = v_submission_id
     WHERE id = ANY(p_attachment_ids)
       AND task_id = p_task_id;
  END IF;

  -- Перемещение задачи. version поднимает trg_bump_task_version (046),
  -- history + moved_to_column_at — trg_record_task_column_move (001),
  -- notify task_review/task_done — 055/064/048, human_override — 065.
  UPDATE public.tasks
     SET "column" = p_target_column,
         metadata = CASE WHEN p_target_column = 'done'
                         THEN COALESCE(metadata, '{}'::jsonb) - 'review_pending'
                         ELSE metadata END
   WHERE id = p_task_id
   RETURNING version INTO v_new_version;

  RETURN jsonb_build_object(
    'submission_id', v_submission_id,
    'reused',        v_reuse_id IS NOT NULL,
    'new_version',   v_new_version
  );
END;
$$;

COMMENT ON FUNCTION public.submit_task IS
  'SUBMIT-01: атомарная сдача задачи — INSERT task_submissions (+ привязка файлов) + UPDATE tasks.column в одной TX. Триггеры history/version/notify отрабатывают сами. EXECUTE — только service_role (маршрут /api/tasks/[id]/submit).';

-- Закрыть RPC от прямого REST-доступа (паттерн 073/081: сервисные функции).
-- p_profile_id доверенный — маршрут резолвит его из Telegram initData.
REVOKE EXECUTE ON FUNCTION public.submit_task(uuid, uuid, text, text, jsonb, uuid[], integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.submit_task(uuid, uuid, text, text, jsonb, uuid[], integer, boolean)
  TO service_role;
