-- ============================================================================
-- 142_subtask_merge_result.sql
-- onitask · SUB-01.3: слияние результата подзадачи в родителя
--
-- Зачем. Требование владельца (п.4): «после того, как подзадачу отправили на
-- ревью и ревьюер согласовал результат — результат подзадачи сливается с
-- основной задачей: файлы и вложения уходят в основную задачу, результат
-- сохраняется в комментариях основной задачи».
--
-- Что добавляется:
--   1. task_comments.source += 'subtask' — отдельное значение для комментария
--      «результат подзадачи слит в задачу».
--   2. merge_subtask_on_done() — триггер на вход подзадачи в «Сделано»:
--        а) task_attachments переезжают на родителя;
--        б) в ленту родителя пишется комментарий с результатом.
--
-- Почему отдельный source, а не переиспользование 'result':
--   'result' (миг. 136) — зелёный, ровно ОДИН итог на задачу. У родителя с
--   3 подзадачами итогов три, и в ленте они должны читаться как разные
--   артефакты. 'review' — циановый, пишет review_action. 'agent' — обычные
--   реплики агента, красить нельзя. Подробно — ADR-2026-09-30 в decisions.md.
--
-- Почему триггер, а не правка review_action:
--   В «Сделано» задача попадает ТРЕМЯ путями (review_action approve, free-move
--   из route.ts, прямая сдача). Правка review_action покрыла бы один. Ровно
--   та же причина, по которой persist_result_on_done сделан триггером (135).
--
-- Storage-объекты НЕ двигаются. Скачивание идёт по storage_path
-- (attachments/[attachmentId]/file → createAttachmentSignedUrl), а путь не
-- зависит от task_id. Переносится только строка манифеста.
--
-- Чего триггер НЕ делает (решение владельца):
--   · НЕ закрывает родителя. Родитель живёт своим циклом и сдаётся на
--     ревью со своим общим результатом. Авто-закрытие отменено.
--   · НЕ трогает колонку родителя.
--
-- Побочный эффект, который стоит знать: подзадача сохраняет СВОЮ ленту —
--   persist_result_on_done (136) отработает по ней как по обычной задаче и
--   напишет зелёный source='result' в комментарии подзадачи. Это правильно:
--   история подзадачи остаётся на месте, а в ленте родителя появляется
--   amber-артефакт со ссылкой на неё. Разные ленты, разные source.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Разрешаем source = 'subtask'
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_source_check;

ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_source_check
  CHECK (source = ANY (ARRAY[
    'twa', 'mcp', 'telegram', 'system', 'review', 'cron', 'agent',
    'result', 'subtask'
  ]));

COMMENT ON CONSTRAINT task_comments_source_check ON public.task_comments IS
  'REV-01 (083): review · REV-02 (136): result · SUB-01 (142): subtask — результат подзадачи, слитый в задачу-родителя при approve.';

-- ---------------------------------------------------------------------------
-- 2. Триггер слияния
--
-- Текст результата берётся из тех же источников, что и в persist_result_on_done
-- (136), иначе в двух местах разъедутся источники правды:
--   metadata->>'ops_terminal_summary'  — итог агента;
--   последняя task_submissions.body_text — ручная сдача исполнителем.
--
-- Плюс список файлов: без него «результат слит» выглядело бы пустым, если
-- подзадача состояла из одного вложения.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_subtask_on_done()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_submission  text;
  v_body        text;
  v_author_id   uuid;
  v_author_name text;
  v_author_type text;
  v_new_files   int := 0;
BEGIN
  -- Только вход в «Сделано» и только для подзадачи.
  -- OLD."column" = 'done' отсекает повторный прогон по уже закрытой строке.
  IF NEW."column" <> 'done' OR OLD."column" = 'done' THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2.1. Вложения → родителю. Только строки манифеста: storage_path не
  --      зависит от task_id, поэтому бинарники в бакете не трогаем.
  --      submission_id обнуляем: сдача принадлежит подзадаче, а файл уже нет.
  --      Если подзадачу потом удалят, её task_submissions уйдут по CASCADE
  --      вместе с submission_id = NULL — потеря результата, которой не будет.
  UPDATE public.task_attachments
     SET task_id      = NEW.parent_task_id,
         submission_id = NULL
   WHERE task_id = NEW.id;
  GET DIAGNOSTICS v_new_files = ROW_COUNT;

  -- 2.2. Текст результата — как в persist_result_on_done (136).
  SELECT s.body_text INTO v_submission
    FROM public.task_submissions s
   WHERE s.task_id = NEW.id
   ORDER BY s.created_at DESC
   LIMIT 1;

  v_submission := NULLIF(left(btrim(COALESCE(v_submission, '')), 1200), '');

  -- 2.3. Комментарий пишем, если есть что сливать: текст результата
  --      ИЛИ переехавшие вложения. Иначе лента засоряется пустыми строками.
  IF v_submission IS NULL AND v_new_files = 0 THEN
    RETURN NEW;
  END IF;

  v_body := format('Подзадача %s выполнена', public.task_full_id(NEW.id));
  IF v_submission IS NOT NULL THEN
    v_body := v_body || E'\n\n' || v_submission;
  END IF;
  IF v_new_files > 0 THEN
    v_body := v_body || E'\n\nФайлы перенесены в задачу: ' || v_new_files;
  END IF;

  -- CHECK task_comments_body_check ограничивает тело 2000 символами.
  v_body := left(v_body, 2000);

  -- 2.4. Автор — исполнитель подзадачи (тот, кто её закрыл).
  SELECT w.id, w.display_name, w.type
    INTO v_author_id, v_author_name, v_author_type
    FROM public.workers w
   WHERE w.id = NEW.assigned_to
   LIMIT 1;

  -- 2.5. Идемпотентность: тот же результат второй раз не пишем.
  IF EXISTS (
    SELECT 1 FROM public.task_comments c
     WHERE c.task_id = NEW.parent_task_id
       AND c.source = 'subtask'
       AND c.body = v_body
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.task_comments
    (workspace_id, task_id, author_id, author_name, author_type,
     body, source, consolidated)
  VALUES
    (NEW.workspace_id, NEW.parent_task_id, v_author_id,
     COALESCE(v_author_name, 'Исполнитель'),
     COALESCE(v_author_type, 'human'),
     v_body, 'subtask', false);

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.merge_subtask_on_done() IS
  'SUB-01 (142): при входе ПОДЗАДАЧИ в «Сделано» переносит её вложения на задачу-родителя (только строки манифеста — storage_path не зависит от task_id) и пишет в ленту родителя комментарий source=''subtask''. Колонку родителя НЕ трогает: авто-закрытие отменено решением владельца. Идемпотентен по телу комментария.';

DROP TRIGGER IF EXISTS trg_merge_subtask_on_done ON public.tasks;

CREATE TRIGGER trg_merge_subtask_on_done
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.merge_subtask_on_done();

-- ============================================================================
-- Верификация
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.task_comments'::regclass
--      AND conname='task_comments_source_check';        -- должен содержать 'subtask'
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.tasks'::regclass
--      AND tgname='trg_merge_subtask_on_done';
--   SELECT public.merge_subtask_on_done();  -- только чтение: CREATE FUNCTION,
--     вызов без триггера — ложное срабатывание невозможно, ожидается ошибка
--     «trigger functions can only be called as triggers» (это нормально).
--
-- Поведенческая проверка — при создании подзадачи в проде (Stage 3/4),
-- здесь эндпоинта для подзадач ещё нет.
-- ============================================================================
