-- ============================================================================
-- 135_persist_result_on_done.sql
-- REV-02: итоговый результат агента сохраняется в комментариях задачи.
--
-- Зачем. Согласование уже пишет комментарий, но шаблонный:
-- «Результат задачи ONI-42 согласован. Задача перенесена в Сделано.» (086).
-- Сам результат жил только в карточке Telegram, а в задаче его не было —
-- для небольших задач («купить 15 кг помидоров») результат негде было
-- посмотреть, кроме чата, и он там терялся.
--
-- Промежуточные результаты мы не храним, поэтому лента и не замусоривается:
-- комментарий создаётся один раз, в момент перехода review → done, и
-- содержит только итог.
--
-- Почему триггер, а не правка review_action:
--   1. В done задача попадает ТРЕМЯ путями. Кроме review_action(approve)
--      (бот-кнопка и TWA-блок) есть free-move: владелец/админ/автор может
--      перевести review → done мимо ревью (src/app/api/tasks/[id]/route.ts,
--      снятие review_pending), и там не пишется НИЧЕГО. Правка review_action
--      покрыла бы только два пути из трёх.
--   2. review_action — функция на 4381 символ; замена целиком в этом проекте
--      не проходит через apply_migration (режет statement). Триггерная
--      функция мала и применяется целиком.
--
-- Что пишем: summary (metadata.ops_terminal_summary), а если его нет —
-- текст последней human-сдачи (task_submissions.body_text, тот же COALESCE,
-- что и в notify_task_done). Плюс recommendation, если агент его прислал.
--
-- Когда НЕ пишем:
--   · has_result_details = true — подробный details уже комментирован
--     самим ops_terminal при переходе в review. Дублировать нечего.
--   · Нечего сохранять (пусто и summary, и сдача).
--
-- source = 'agent': содержимое — результат агента, а не решение ревьюера,
-- поэтому цианового бордера isReviewDecision на нём не будет (тот
-- остаётся у комментария «согласован» из review_action).
-- ============================================================================

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
BEGIN
  IF NEW."column" <> 'done' OR OLD."column" IS DISTINCT FROM 'review' THEN
    RETURN NEW;
  END IF;

  -- Подробности уже в ленте: ops_terminal закомментировал их при входе в review.
  IF COALESCE((NEW.metadata->>'has_result_details')::boolean, false) THEN
    RETURN NEW;
  END IF;

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

  IF v_summary IS NULL AND v_recommend IS NULL AND v_submission IS NULL THEN
    RETURN NEW;
  END IF;

  -- Автор: исполнитель задачи. Для агентской задачи это и есть worker агента.
  SELECT w.id, w.display_name, w.type
    INTO v_author_id, v_author_name, v_author_type
    FROM public.workers w
   WHERE w.id = NEW.assigned_to
   LIMIT 1;

  v_body := format('Результат задачи %s', public.task_full_id(NEW.id));
  IF v_summary IS NOT NULL THEN
    v_body := v_body || E'\n\n' || v_summary;
  ELSIF v_submission IS NOT NULL THEN
    v_body := v_body || E'\n\n' || v_submission;
  END IF;
  IF v_recommend IS NOT NULL THEN
    v_body := v_body || E'\n\nРекомендация: ' || v_recommend;
  END IF;

  INSERT INTO public.task_comments
    (workspace_id, task_id, author_id, author_name, author_type,
     body, source, consolidated)
  VALUES
    (NEW.workspace_id, NEW.id, v_author_id,
     COALESCE(v_author_name, 'Агент'),
     COALESCE(v_author_type, 'agent'),
     v_body, 'agent', false);

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_persist_result_on_done ON public.tasks;

CREATE TRIGGER trg_persist_result_on_done
AFTER UPDATE OF "column" ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.persist_result_on_done();

COMMENT ON FUNCTION public.persist_result_on_done IS
  'REV-02 (135): при переходе review → done сохраняет итоговый результат в комментариях. Пропускает задачи, у которых details уже закомментирован ops_terminal. Накрывает и free-move, минуя review_action.';
