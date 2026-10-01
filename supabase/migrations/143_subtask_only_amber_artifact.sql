-- ============================================================================
-- 143_subtask_only_amber_artifact.sql
-- onitask · SUB-01.4: у подзадачи остаётся ровно один артефакт в комментариях
--
-- Зачем. Решение владельца (2026-10-01): «зелёный в подзадаче не используем, в
-- комментарии всегда уходит — финальный согласованный янтарный вариант, который
-- и уходит в комментарии. До этого просто отправляем результат ревьюеру, пока
-- он не согласует».
--
-- Что это значит технически. На вход подзадачи в «Сделано» срабатывают ДВА
-- триггера, и оба писали в ленту самой подзадачи:
--   · 136 persist_result_on_done — зелёный source='result';
--   · 086 review_action(approve)  — циановый source='review' («Результат задачи
--     <id> согласован»).
-- Плюс 142 merge_subtask_on_done — янтарный source='subtask' в ленту РОДИТЕЛЯ.
-- Оставляем только последний: он и есть «финальный согласованный янтарный».
--
-- До этого момента результат виден ревьюеру через префилл формы ревью
-- (последняя task_submissions), а не через комментарий — ровно то, что нужно
-- владельцу.
--
-- Почему так:
--   1. Зелёный итог у подзадачи вводил в заблуждение: он читается как
--      «результат уже итоговый», хотя до approve ничего не согласовано.
--   2. Циановый комментарий ревью — запись о решении по задаче, а не по
--      подзадаче; в ленте родителя решения принимаются по подзадачам одним
--      янтарным артефактом (142).
--   3. Обе задачи не пишутся в ленту подзадачи, которой в UI всё равно нет —
--      лента комментариев показывается только у родителя.
--
-- Почему persist_result_on_done переопределяется, а не правится на месте:
-- так же сделан 136 над 135 — CREATE OR REPLACE на всём теле функции.
--
-- Почему циановый комментарий гасится триггером на task_comments, а не
-- правкой review_action: review_action — функция на 4381 символов, и замена
-- тела в этом проекте не проходит через apply_migration (режет statement).
-- BEFORE INSERT с RETURN NULL делает ровно то же и остаётся триггерной
-- функцией — тот же приём, что в 135/136.
--
-- Что НЕ меняется:
--   · metadata.last_fix_reason (миг. 051) по-прежнему пишется при fix —
--     это канал обратной связи, и его показывает шторка подзадачи.
--   · merge_subtask_on_done (142) не трогаем.
--   · Самостоятельные задачи ведут себя ровно как раньше.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. persist_result_on_done: подзадачи молчат
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_result_on_done()
RETURNS TRIGGER AS $fn$
DECLARE
  v_body        text;
  v_summary     text;
  v_recommend   text;
  v_submission  text;
  v_author_id   uuid;
  v_author_name text;
  v_author_type text;
  v_is_agent    boolean;
BEGIN
  -- Любой ВХОД в done: и согласованный (review → done), и прямой.
  -- Повторный проход (OLD уже done) — не переход, молчим.
  IF NEW."column" <> 'done' OR OLD."column" = 'done' THEN
    RETURN NEW;
  END IF;

  -- SUB-01 (143): у подзадачи единственный артефакт — янтарный из 142, и он
  -- живёт в ленте РОДИТЕЛЯ. Зелёный итог в ленте подзадачи не пишем: до
  -- approve ничего не согласовано, и итог сначала уходит ревьюеру.
  IF NEW.parent_task_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Итог агента, если он его прислал; иначе — текст последней сдачи.
  v_summary := NULLIF(left(btrim(COALESCE(NEW.metadata->>'ops_terminal_summary', '')), 1800), '');
  v_recommend := NULLIF(left(btrim(COALESCE(NEW.metadata->>'recommendation', '')), 800), '');

  IF v_summary IS NULL THEN
    SELECT s.body_text INTO v_submission
      FROM public.task_submissions s
     WHERE s.task_id = NEW.id
     ORDER BY s.created_at DESC
     LIMIT 1;
    v_submission := NULLIF(left(btrim(COALESCE(v_submission, '')), 1800), '');
  END IF;

  -- Сохранять нечего — ленту не засоряем.
  IF v_summary IS NULL AND v_recommend IS NULL AND v_submission IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := format('Результат задачи %s', public.task_full_id(NEW.id));
  IF v_summary IS NOT NULL THEN
    v_body := v_body || E'\n\n' || v_summary;
  ELSIF v_submission IS NOT NULL THEN
    v_body := v_body || E'\n\n' || v_submission;
  END IF;
  IF v_recommend IS NOT NULL THEN
    v_body := v_body || E'\n\nРекомендация: ' || v_recommend;
  END IF;

  -- Тот же текст результата второй раз не пишем.
  IF EXISTS (
    SELECT 1 FROM public.task_comments c
     WHERE c.task_id = NEW.id
       AND c.source = 'result'
       AND c.body = v_body
  ) THEN
    RETURN NEW;
  END IF;

  -- Автор: исполнитель задачи (для агентской задачи это worker агента).
  SELECT w.id, w.display_name, w.type
    INTO v_author_id, v_author_name, v_author_type
    FROM public.workers w
   WHERE w.id = NEW.assigned_to
   LIMIT 1;

  v_is_agent := v_summary IS NOT NULL;

  INSERT INTO public.task_comments
    (workspace_id, task_id, author_id, author_name, author_type,
     body, source, consolidated)
  VALUES
    (NEW.workspace_id, NEW.id, v_author_id,
     COALESCE(v_author_name, CASE WHEN v_is_agent THEN 'Агент' ELSE 'Исполнитель' END),
     COALESCE(v_author_type, CASE WHEN v_is_agent THEN 'agent' ELSE 'human' END),
     v_body, 'result', false);

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.persist_result_on_done IS
  'REV-02 (135, 136): при любом входе в «Сделано» итог задачи пишется одним комментарием source=result. SUB-01 (143): ПОДЗАДАЧИ пропускаются — их единственный артефакт это янтарный source=subtask в ленте родителя (миг. 142).';

-- ---------------------------------------------------------------------------
-- 2. Циановый комментарий ревью — тоже не пишем в ленту подзадачи
-- ---------------------------------------------------------------------------
-- Источник: review_action(approve), миг. 086. Правкой RPC невозможна (см. шапку).
-- BEFORE INSERT + RETURN NULL — стандартный способ отменить вставку строки.
-- Гасим ТОЛЬКО source='review' на подзадачах: обычные реплики, результаты,
-- системные и янтарные 142 проходят без изменений.
CREATE OR REPLACE FUNCTION public.skip_subtask_review_comment()
RETURNS TRIGGER AS $fn$
DECLARE
  v_is_subtask boolean;
BEGIN
  IF NEW.source IS DISTINCT FROM 'review' THEN
    RETURN NEW;
  END IF;

  SELECT (t.parent_task_id IS NOT NULL) INTO v_is_subtask
    FROM public.tasks t
   WHERE t.id = NEW.task_id;

  IF COALESCE(v_is_subtask, false) THEN
    RETURN NULL;  -- отменяем вставку
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.skip_subtask_review_comment IS
  'SUB-01 (143): отменяет комментарии source=''review'' в ленте ПОДЗАДАЧИ. Решение по подзадаче выражается янтарным артефактом source=''subtask'' в ленте родителя (миг. 142), а причина возврата остаётся в metadata.last_fix_reason.';

DROP TRIGGER IF EXISTS trg_skip_subtask_review_comment ON public.task_comments;

CREATE TRIGGER trg_skip_subtask_review_comment
BEFORE INSERT ON public.task_comments
FOR EACH ROW
EXECUTE FUNCTION public.skip_subtask_review_comment();

-- ---------------------------------------------------------------------------
-- Верификация
-- ---------------------------------------------------------------------------
--   -- Подзадача молчит на обоих артефактах:
--   --   1) создать подзадачу, сдать её (POST /api/tasks/<sub>/submit),
--   --      согласовать (POST /api/tasks/<sub>/review action=approve);
--   --   2) SELECT source, count(*) FROM task_comments
--   --      WHERE task_id IN (<sub_id>, <parent_id>) GROUP BY 1;
--   --   ожидается: у родителя ровно одна строка source='subtask', у подзадачи 0.
--   -- cause возврата на месте:
--   --   SELECT metadata->>'last_fix_reason' FROM tasks WHERE id = <sub_id>;
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.task_comments'::regclass
--      AND tgname = 'trg_skip_subtask_review_comment';
-- ============================================================================