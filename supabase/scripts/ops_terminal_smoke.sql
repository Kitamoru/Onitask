-- ============================================================================
-- ops_terminal_smoke.sql — дымовой прогон ops_terminal с откатом.
--
-- ЗАЧЕМ. Тело plpgsql разбирается Postgres только в рантайме: `CREATE OR
-- REPLACE FUNCTION` проходит, даже если внутри несуществующая колонка. Поэтому
-- 2026-09-28 две сломанные версии доехали до прода незаметно — tsc и vitest
-- были зелёными, базы в CI нет:
--
--   1. `AND w.agent_name = v_exec.agent_name` — в workers такой колонки нет
--      (есть type + source_id). Каждый успешный прогон агента падал с
--      «column w.agent_name does not exist», результат терялся целиком.
--   2. `body_text` в INSERT INTO task_comments — колонка называется body, и
--      ещё пропущены обязательные author_name и consolidated.
--
-- КАК ЗАПУСКАТЬ. После ЛЮБОГО изменения тела ops_* — до релиза, не после:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/ops_terminal_smoke.sql
--   или одним execute_sql.
--
-- ЧТО ДЕЛАЕТ. Берёт последнюю открытую лизу, вызывает ops_terminal с её же
-- runtime_id и версией — то есть проходит весь путь: UPDATE tasks, поиск
-- воркера, INSERT комментария, закрытие execution, INSERT agent_events.
-- Печатает SMOKE_RESULT=PASS либо текст SQL-ошибки. В конце всегда РЕЙЗАЕТ
-- исключение, поэтому необратимая транзакция откатывается и прод не меняется:
-- задача остаётся in_progress, лиза жива, комментария нет.
--
-- Ожидаемый вывод: ERROR: SMOKE_RESULT=PASS
-- (ERROR — это нормально, так и выглядит принудительный откат.)
-- ============================================================================

DO $smoke$
DECLARE
  v_exec    record;
  v_outcome text;
BEGIN
  SELECT e.id, e.runtime_id, e.task_id, t.version, e.agent_name
    INTO v_exec
    FROM public.task_executions e
    JOIN public.tasks t ON t.id = e.task_id
   WHERE e.status = 'open'
     AND t.active_claim_id = e.id
   ORDER BY e.claimed_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SMOKE_RESULT=SKIP (нет открытой лизы — нечего проверять)';
  END IF;

  BEGIN
    PERFORM public.ops_terminal(
      p_execution_id => v_exec.id,
      p_runtime_id   => v_exec.runtime_id,
      p_task_id      => v_exec.task_id,
      p_task_version => v_exec.version,
      p_outcome      => 'review',
      p_summary      => 'smoke: проверка тела ops_terminal',
      p_metadata     => '{"details":"smoke: детали для комментария"}'::jsonb,
      p_next_owner   => NULL
    );
    v_outcome := 'PASS';
  EXCEPTION WHEN OTHERS THEN
    v_outcome := 'FAIL: ' || SQLERRM;
  END;

  -- Сюда мы дойдём только после успешного или упавшего вызова. Рейз всегда
  -- откатывает транзакцию, поэтому вызов выше не останется в проде.
  RAISE EXCEPTION 'SMOKE_RESULT=%', v_outcome;
END
$smoke$;
