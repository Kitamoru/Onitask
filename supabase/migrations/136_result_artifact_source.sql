-- ============================================================================
-- 136_result_artifact_source.sql
-- REV-02: итоговый результат — отдельный артефакт с source='result'.
--
-- Зачем. Требование владельца: «Результат» — это один итоговый комментарий,
-- и зелёным должен быть именно он. У 135 были три несоответствия:
--
--   1. Срабатывала только на review → done. Прямая сдача в «Сделано» без
--      ревьюера (drag в done из in_progress, шаг «Результат» / SUBMIT-01)
--      результата не оставляла вообще — а это половина сценариев.
--   2. Пропускала задачи с has_result_details = true, считая, что «дублировать
--      нечего». Нечего: details — это подробности ПРИ СДАЧЕ, а итог — это то,
--      что принято. Теперь details остаётся отдельным обычным комментарием,
--      а рядом появляется итог.
--   3. Писала source = 'agent'. Этим же source помечаются комментарии агента
--      в общем случае, поэтому красить «результат» тем же предикатом, что и
--      обычную агентскую реплику, нельзя — залились бы и details. Отдельное
--      значение 'result' снимает неоднозначность.
--
-- Правило (зафиксировано владельцем):
--   · ревьюер назначен  → итог пишется на review → done (согласованный);
--   · ревьюер не назначен → итог пишется на прямой переход в done (сданный);
--   шаблон один и тот же — «Результат задачи <full_id>» + текст, что и у людей,
--   и у агентов.
--
-- has_result_details больше не влияет на решение писать или не писать: итог
-- пишется всегда, когда есть что сохранить, а details остаётся отдельным
-- неокрашенным комментарием.
--
-- Идемпотентность: повторный переход с тем же текстом результата не создаёт
-- второй комментарий (защита от дублей при повторных срабатываниях).
-- ============================================================================

-- 1. Разрешаем новое значение source.
ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_source_check;

ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_source_check
  CHECK (source = ANY (ARRAY[
    'twa', 'mcp', 'telegram', 'system', 'review', 'cron', 'agent', 'result'
  ]));

-- 2. Переписываем функцию: любой вход в «Сделано», отдельный source.

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

  -- Подпись без исполнителя: «Агент» только если итог действительно агентский,
  -- иначе прямая сдача человеком — это «Исполнитель».
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
  'REV-02 (136): при любом входе в «Сделано» сохраняет итоговый результат одним комментарием с source=result. Шаблон общий для людей и агентов. Согласованный результат пишется на review → done, прямой — на переход из in_progress. has_result_details больше не подавляет итог: details остаётся отдельным комментарием.';