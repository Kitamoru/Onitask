-- ============================================================================
-- 139_task_subtasks.sql
-- onitask · SUB-01: подзадачи как строки в tasks (parent_task_id)
--
-- Зачем. Требование владельца: «меня бесит создавать новую задачу ради
-- подзадачи». Разбор архитектуры показал, что подзадача = строка в `tasks`
-- с `parent_task_id` — единственный путь, при котором не переписывается
-- весь контур (стрим, TG-уведомление, сдача, ревью, вложения, комментарии,
-- права, дедлайны, Realtime). Отдельная таблица означала бы дублирование.
--
-- Что добавляется:
--   1. tasks.parent_task_id  — FK на tasks(id) ON DELETE CASCADE.
--   2. tasks.subtask_index   — порядковый номер 1..10 внутри родителя.
--   3. Гарды, чтобы подзадача не трогала контуры, где она лишняя:
--      нумерация задач, дедупликат-очередь.
--   4. task_full_id / find_task_by_full_id — формат «ONI-42-SUB-1».
--
-- Про нумерацию (важно). `next_task_number` считает MAX(task_number), а не
-- `workspace_task_counters`, поэтому task_number = NULL у подзадачи не
-- оставляет дыры и не сдвигает нумерацию. Уникальный индекс
-- idx_tasks_task_number (workspace_id, task_number) NULL переживает —
-- в PostgreSQL NULL != NULL в unique btree.
--
-- Удаление родителя. ON DELETE CASCADE уберёт строки подзадач, а по цепочке
-- и строки task_attachments. Бинарники в Storage при этом останутся сиротами —
-- их заберёт ночной gc_orphan_task_attachments (миграция 081). Явная чистка
-- в DELETE /api/tasks/[id] добавляется в Stage 3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Колонки
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid
    REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS subtask_index smallint;

COMMENT ON COLUMN public.tasks.parent_task_id IS
  'SUB-01: NULL = обычная задача. UUID родителя = подзадача. ON DELETE CASCADE — удаление родителя уносит подзадачи.';
COMMENT ON COLUMN public.tasks.subtask_index IS
  'SUB-01: порядковый номер подзадачи внутри родителя (1..10). Для обычной задачи NULL. task_number у подзадачи тоже NULL — display-id собирает task_full_id() как PREFIX-N-SUB-i.';

-- 1.1. Лимит 10 подзадач — на уровне БД, а не только в роуте.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_subtask_index_check
  CHECK (subtask_index IS NULL OR subtask_index BETWEEN 1 AND 10);

-- 1.2. Поля идут в паре: нельзя задать индекс без родителя и наоборот.
--      Без этого CHECK вилка «родитель есть, индекс NULL» дала бы подзадачу
--      без номера — task_full_id() вернул бы NULL, и карточка в TG потеряла
--      бы идентификатор.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_subtask_fields_paired
  CHECK ((parent_task_id IS NULL) = (subtask_index IS NULL));

-- ---------------------------------------------------------------------------
-- 2. Индексы
-- ---------------------------------------------------------------------------
-- Уникальность позиции внутри родителя: две подзадачи не могут стать №3.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_parent_subtask_index
  ON public.tasks (parent_task_id, subtask_index)
  WHERE parent_task_id IS NOT NULL;

-- Поиск «все подзадачи родителя» — основной read-path карточки задачи.
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id
  ON public.tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. assign_task_number: подзадача не жжёт номер родителя
--
-- Иначе 10 подзадач выжгли бы 10 номеров, и у следующей задачи воркспейса
-- была бы дыра в нумерации (пользователь видит ONI-42, потом ONI-53).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_task_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Подзадача: display-id собирается от номера РОДИТЕЛЯ (task_full_id).
  IF NEW.parent_task_id IS NOT NULL THEN
    NEW.task_number := NULL;
    RETURN NEW;
  END IF;

  NEW.task_number := public.next_task_number(NEW.workspace_id);
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.assign_task_number() IS
  'SUB-01 (139): подзадаче (parent_task_id IS NOT NULL) task_number = NULL — её идентификатор производный (PREFIX-N-SUB-i). Обычные задачи нумеруются как раньше.';

-- ---------------------------------------------------------------------------
-- 4. enqueue_duplicate_check: подзадача не ставится в очередь дедупликации
--
-- Без гарда 10 подзадач = 10 дубль-джобов, а «Написать текст» почти всегда
-- «похоже» на родителя и на соседние подзадачи. Контур DUP-01 существует
-- ради дублей СРЕДИ задач, а не среди пунктов одной задачи.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_duplicate_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- SUB-01: подзадача — часть родителя, не самостоятельная задача.
  IF NEW.parent_task_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.enrichment_queue
    (workspace_id, type, payload, status, scheduled_at)
  VALUES (
    NEW.workspace_id,
    'duplicate_check',
    jsonb_build_object(
      'task_id',      NEW.id,
      'title',        NEW.title,
      'workspace_id', NEW.workspace_id
    ),
    'pending',
    NOW() + INTERVAL '5 seconds'
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enqueue_duplicate_check() IS
  'SUB-01 (139): подзадачи (parent_task_id IS NOT NULL) не ставятся в очередь duplicate_check — они не самостоятельные задачи.';

-- ---------------------------------------------------------------------------
-- 5. task_full_id: «ONI-42-SUB-1»
--
-- Старая версия склеивала prefix и task_number; при task_number = NULL
-- конкатенация даёт NULL, и вызывающий код (карточки TG, комментарии,
-- уведомления) получил бы пустой идентификатор.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_full_id(p_task_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT CASE
    WHEN t.task_number IS NOT NULL
      THEN w.task_prefix || '-' || t.task_number::text
    WHEN t.subtask_index IS NOT NULL AND p.task_number IS NOT NULL
      THEN w.task_prefix || '-' || p.task_number::text
           || '-SUB-' || t.subtask_index::text
    ELSE NULL
  END
  FROM public.tasks t
  JOIN public.workspaces w ON w.id = t.workspace_id
  LEFT JOIN public.tasks p ON p.id = t.parent_task_id
  WHERE t.id = p_task_id;
$fn$;

COMMENT ON FUNCTION public.task_full_id(uuid) IS
  'SUB-01 (139): обычная задача — PREFIX-N; подзадача — PREFIX-N-SUB-i (номер родителя + позиция). NULL только если номер не может быть собран.';

-- ---------------------------------------------------------------------------
-- 6. find_task_by_full_id: обратное преобразование
--
-- split_part(p_full_id, '-', 2)::int на «ONI-42-SUB-1» даёт 42 — то есть
-- функция молча вернула бы id РОДИТЕЛЯ на запрос подзадачи. Отдельная ветка.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_task_by_full_id(p_full_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_prefix text;
  v_number int;
  v_sub    int;
BEGIN
  v_prefix := split_part(p_full_id, '-', 1);
  v_number := split_part(p_full_id, '-', 2)::int;

  -- Подзадача: PREFIX-N-SUB-i
  IF split_part(p_full_id, '-', 3) = 'SUB' THEN
    v_sub := split_part(p_full_id, '-', 4)::int;
    RETURN (
      SELECT t.id
      FROM public.tasks t
      JOIN public.workspaces w ON w.id = t.workspace_id
      JOIN public.tasks p    ON p.id = t.parent_task_id
      WHERE w.task_prefix   = v_prefix
        AND p.task_number   = v_number
        AND t.subtask_index = v_sub
    );
  END IF;

  -- Обычная задача — прежнее поведение без изменений.
  RETURN (
    SELECT t.id
    FROM public.tasks t
    JOIN public.workspaces w ON w.id = t.workspace_id
    WHERE w.task_prefix  = v_prefix
      AND t.task_number  = v_number
  );
END;
$fn$;

COMMENT ON FUNCTION public.find_task_by_full_id(text) IS
  'SUB-01 (139): понимает и «PREFIX-N» (задача), и «PREFIX-N-SUB-i» (подзадача). Без отдельной ветки подзадача резолвилась бы в родителя.';

-- ---------------------------------------------------------------------------
-- 7. Мёртвый ключ metadata.checklist — вычищаем
--
-- Писался ToggleSwitch'ом «Чеклист задачи» (TaskViewEdit), не читался ни
-- одним потребителем в кодовой базе. В проде: 42 задачи с ключом, у всех
-- пустой массив, непустых 0. Данных не теряем.
-- ---------------------------------------------------------------------------
UPDATE public.tasks
   SET metadata = metadata - 'checklist'
 WHERE metadata ? 'checklist';

-- ============================================================================
-- Верификация после применения
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='tasks' AND column_name IN ('parent_task_id','subtask_index');
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.tasks'::regclass
--    AND tgname='trg_assign_task_number';            -- триггер не пересоздаём
--   SELECT public.task_full_id(id) FROM public.tasks LIMIT 3;
--   SELECT count(*) FROM public.tasks WHERE metadata ? 'checklist';  -- ожидается 0
--   SELECT count(*) FROM public.tasks WHERE metadata->'external_links' IS NOT NULL;
--     -- должно совпасть с числом задач со ссылками ДО миграции (sanity check:
--     --    - 'checklist' снёс только свой ключ, чужие не тронуты)
-- ============================================================================
