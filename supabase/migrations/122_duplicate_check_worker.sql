-- ============================================================================
-- 122_duplicate_check_worker.sql
-- onitask · Потребитель enrichment_queue типа 'duplicate_check' (DUP-01)
--
-- Проблема (найдена 2026-09-26, live-SQL аудит): постановщик есть
-- (`trg_enqueue_duplicate_check`, sql_anomalies §5.3), RPC детекта есть
-- (`find_duplicate_tasks`, pg_trgm, порог 0.7, окно 30 дней), а
-- ПОТРЕБИТЕЛЯ нет ни в одной Edge Function: `enrich-task/index.ts:485`
-- берёт только `.eq('type','card')`. В итоге детект дублей не работал
-- никогда, а в очереди лежало 53 pending-джобы (oldest 2026-08-19),
-- 3 из них — сироты (задача удалена).
--
-- Решение владельца от 2026-09-25: достроить, не удалять. Новая Edge
-- Function не нужна — вся работа выразима в SQL поверх готового
-- `find_duplicate_tasks`, а доставку в Telegram уже умеет `bot-notify`
-- (потребитель типа 'bot_notify' + паттерн дебаунса из §5.1).
--
-- Реализация по контракту sql_anomalies §5.3:
--   · порог 0.7, только не-done задачи, окно 30 дней (делает RPC);
--   · алертим только ПО ПЕРВОМУ совпадению (в RPC их до 5);
--   · окно подавления повторов — 2 часа (`shouldSendAlert`, §5.1);
--   · алерт идёт в enrichment_queue типом 'bot_notify', alert_type
--     'duplicate' (его ждёт buildBroadcastCard в bot-notify).
--
-- Отличие от документированного TS-прототипа: тот вставлял готовый `text`
-- в payload, но консьюмер `text` игнорирует (buildBroadcastCard строит
-- карточку из get_task_card_data). Поэтому здесь кладём структурные поля,
-- а текст рендерит карточка — см. ветку 'duplicate' в bot-notify.
--
-- ЗАЩИТА ОТ ЛАВИНЫ (`p_stale_after`): дебаунс постановщика — 5 секунд,
-- т.е. джоба должна быть обработана в первые минуты жизни. Алертить по
-- джобам, пролежавшим сутки, бессмысленно (пользователь давно забыл) и
-- опасно: при включении воркера 48 старых джоб выплеснули бы в Telegram
-- 48 сообщений разом. Такие джобы закрываем БЕЗ алерта. Окно настраивается
-- аргументом; для разбора бэклога вручную можно вызвать с бОльшим.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_duplicate_check(
  p_batch       integer DEFAULT 20,
  p_stale_after interval DEFAULT interval '1 hour'
)
RETURNS TABLE(processed int, alerted int, skipped_stale int, skipped_orphans int, no_match int)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_job            record;
  v_task           record;
  v_dup            record;
  v_processed      int := 0;
  v_alerted        int := 0;
  v_stale          int := 0;
  v_orphans        int := 0;
  v_no_match       int := 0;
  v_recent_alert   timestamptz;
BEGIN
  -- Берём джобы с наступившим scheduled_at (дебаунс 5 секунд от триггера).
  -- FOR UPDATE SKIP LOCKED — чтобы параллельные запуски крона не взяли
  -- одну джобу дважды (паттерн ops_publisher_tick / 091).
  FOR v_job IN
    SELECT q.id, q.workspace_id, q.payload, q.created_at
    FROM public.enrichment_queue q
    WHERE q.type = 'duplicate_check'
      AND q.status = 'pending'
      AND q.scheduled_at <= NOW()
    ORDER BY q.scheduled_at ASC
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    -- Задача могла быть удалена между постановкой джобы и обработкой —
    -- тогда проверять нечего, закрываем молча.
    SELECT t.id, t.title, t."column"
      INTO v_task
      FROM public.tasks t
     WHERE t.id = NULLIF(v_job.payload->>'task_id', '')::uuid;

    IF v_task.id IS NULL THEN
      v_orphans := v_orphans + 1;
      UPDATE public.enrichment_queue
         SET status = 'done', processed_at = NOW()
       WHERE id = v_job.id;
      CONTINUE;
    END IF;


    -- Давняя джоба: детект уже неактуален, алерт был бы шумом.
    IF v_job.created_at < NOW() - p_stale_after THEN
      v_stale := v_stale + 1;
      UPDATE public.enrichment_queue
         SET status = 'done', processed_at = NOW()
       WHERE id = v_job.id;
      CONTINUE;
    END IF;

    -- Детект: тот самый RPC из §5.3, порог 0.7.
    SELECT d.id, d.title, d.similarity
      INTO v_dup
      FROM public.find_duplicate_tasks(
             (v_job.payload->>'task_id')::uuid,
             v_task.title,
             v_job.workspace_id,
             0.7
           ) d
     LIMIT 1;

    IF v_dup.id IS NULL THEN
      v_no_match := v_no_match + 1;
      UPDATE public.enrichment_queue
         SET status = 'done', processed_at = NOW()
       WHERE id = v_job.id;
      CONTINUE;
    END IF;

    -- Окно подавления повторов: 2 часа (§5.1 shouldSendAlert).
    SELECT MAX(q2.created_at) INTO v_recent_alert
      FROM public.enrichment_queue q2
     WHERE q2.type = 'bot_notify'
       AND q2.payload->>'alert_type' = 'duplicate'
       AND q2.payload->>'task_id' = (v_job.payload->>'task_id')::text;

    IF v_recent_alert IS NOT NULL AND v_recent_alert > NOW() - interval '2 hours' THEN
      UPDATE public.enrichment_queue
         SET status = 'done', processed_at = NOW()
       WHERE id = v_job.id;
      CONTINUE;
    END IF;

    -- Алерт. Структурные поля, а не готовый text: консьюмер рендерит
    -- карточку задачи по task_id и сам собирает строку «Похожа на …».
    INSERT INTO public.enrichment_queue
      (workspace_id, type, payload, status, scheduled_at)
    VALUES (
      v_job.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type',             'duplicate',
        'workspace_id',           v_job.workspace_id,
        'task_id',                v_task.id,
        'full_id',                public.task_full_id(v_task.id),
        'title',                  v_task.title,
        'duplicate_of_task_id',   v_dup.id,
        'duplicate_of_full_id',   public.task_full_id(v_dup.id),
        'duplicate_of_title',     v_dup.title,
        'similarity',             round(v_dup.similarity::numeric, 3)
      ),
      'pending',
      NOW()
    );

    v_alerted := v_alerted + 1;
    UPDATE public.enrichment_queue
       SET status = 'done', processed_at = NOW()
     WHERE id = v_job.id;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_alerted, v_stale, v_orphans, v_no_match;
END;
$function$;


COMMENT ON FUNCTION public.process_duplicate_check(integer, interval) IS
  'DUP-01: потребитель enrichment_queue типа duplicate_check. Вызывает find_duplicate_tasks (pg_trgm, 0.7), при совпадении кладёт bot_notify (alert_type=duplicate) с окном подавления 2 часа. Джобы старше p_stale_after закрываются без алерта, чтобы не выплеснуть бэклог в Telegram. Крон: duplicate-check-tick, раз в 5 минут.';

-- ---------------------------------------------------------------------------
-- Доступ: вызывается только из pg_cron (роль postgres). Аналогично
-- get_bot_notify_cron_secret / agent_runtime_set_secret (067/089/092) —
-- Data API вызывать не должен.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.process_duplicate_check(integer, interval)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cron: раз в 5 минут. Не ежеминутно: дебаунс постановщика — 5 секунд,
-- но пиковая нагрузка не нужна, а джобы копятся только на новых задачах.
-- unschedule-by-name — идемпотентность при пере-применении (паттерн 091/096).
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('duplicate-check-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'duplicate-check-tick');

SELECT cron.schedule(
  'duplicate-check-tick',
  '*/5 * * * *',
  $$SELECT public.process_duplicate_check(20, interval '1 hour')$$
);

-- ---------------------------------------------------------------------------
-- Разовая чистка: джобы-сироты (payload.task_id без задачи) из бэклога.
-- Их обработчик закрыл бы и сам, но они висят с августа и только мешают
-- в диагностике. Живые джобы НЕ трогаем — их закроет воркер по
-- p_stale_after (все они старше часа → done без алерта, лавины не будет).
-- ---------------------------------------------------------------------------
DELETE FROM public.enrichment_queue q
WHERE q.type = 'duplicate_check'
  AND q.status = 'pending'
  AND NULLIF(q.payload->>'task_id', '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = (q.payload->>'task_id')::uuid
  );
