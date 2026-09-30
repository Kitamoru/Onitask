-- ============================================================================
-- 140_subtask_read_filters_part1.sql
-- onitask · SUB-01: подзадачи не видны агрегатам (часть 1 из 2)
--
-- Зачем. Подзадачи не самостоятельные задачи: владелец решил, что они
-- видны только в стриме исполнителя и внутри карточки родителя, а в
-- метрики доски НЕ попадают и нагрузку не создают — её наследует родитель.
--
-- Решение владельца по A-9: «не считаем нагрузку, он ее наследует».
-- Без этого фильтра 3 подзадачи в работе дали бы исполнителю
-- cognitive_load 5 при лимите 3 → «перегружен» по одной задаче.
--
-- Почему триггерами не обойтись. Триггеры пишут в enrichment_queue
-- (task_started, task_review, task_done) — их НЕ трогаем: уведомления
-- подзадач нужны. Здесь закрываются ИСТОЧНИКИ ДЛЯ АГРЕГАТОВ: вьюхи и
-- функции, которые суммируют/считают задачи.
--
-- Фильтр `parent_task_id IS NULL` = «это самостоятельная задача».
--
-- РАЗДЕЛЕНО НА 2 МИГРАЦИИ намеренно: apply_migration режет крупные
-- statement (см. комментарий в миграции 135), а каждый CREATE OR REPLACE
-- VIEW здесь — отдельное большое тело.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Вьюха 1/4. attention_risk_pulse
--
-- Считает активные/блокированные/ревью-критические задачи по работникам.
-- Подзадачи в этих счётчиках — шум: у исполнителя одна задача, а счётчик
-- покажет три. Фильтр добавлен в оба места: в LEFT JOIN tasks (набор строк)
-- и в worker_switch_metrics нельзя — там task_column_history, он считает
-- переключения по всем задачам, включая подзадачи. Это осознанно: смена
-- статуса подзадачи — реальное действие человека, и счётчик отражает
-- фактическую переключаемость.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.attention_risk_pulse AS
WITH worker_task_metrics AS (
  SELECT w.id AS worker_id,
         w.display_name,
         w.workspace_id,
         count(DISTINCT t.id) FILTER (WHERE t."column" = 'in_progress' AND t.assigned_to = w.id AND t.is_inbox = false) AS active_tasks,
         count(DISTINCT t.id) FILTER (WHERE t.is_blocked = true AND t.assigned_to = w.id AND t."column" <> 'done') AS blocked_tasks,
         count(DISTINCT t.id) FILTER (WHERE t."column" = 'review' AND t.reviewer_id = w.id) AS review_tasks,
         count(DISTINCT t.id) FILTER (WHERE t.deadline_urgency = 'critical' AND t.assigned_to = w.id AND t."column" <> 'done' AND t.is_inbox = false) AS critical_deadline_tasks
  FROM workers w
  JOIN workspace_settings ws ON ws.workspace_id = w.workspace_id
  LEFT JOIN tasks t ON (
    ((t.assigned_to = w.id AND t."column" = 'in_progress')
     OR (t.reviewer_id = w.id AND t."column" = 'review'))
    AND t.is_blocked = false
    AND t.is_inbox = false
    AND t.workspace_id = w.workspace_id
    -- SUB-01 (140): подзадачи не самостоятельные задачи
    AND t.parent_task_id IS NULL
  )
  WHERE w.type = 'human' AND w.is_active = true
  GROUP BY w.id, w.display_name, w.workspace_id
),
worker_switch_metrics AS (
  SELECT tch.moved_by AS worker_id,
         count(DISTINCT tch.task_id) AS context_switches_today
  FROM task_column_history tch
  WHERE tch.moved_by IS NOT NULL AND tch.moved_at >= CURRENT_DATE
  GROUP BY tch.moved_by
),
scored AS (
  SELECT wtm.worker_id, wtm.display_name, wtm.workspace_id, wtm.active_tasks,
         COALESCE(wsm.context_switches_today, 0) AS context_switches_today,
         wtm.blocked_tasks, wtm.review_tasks, wtm.critical_deadline_tasks,
         LEAST(100::numeric, round(
           wtm.active_tasks::numeric * 15.0
           + COALESCE(wsm.context_switches_today, 0)::numeric * 10.0
           + wtm.blocked_tasks::numeric * 12.0
           + wtm.review_tasks::numeric * 5.0
           + wtm.critical_deadline_tasks::numeric * 15.0
         )) AS attention_risk_score
  FROM worker_task_metrics wtm
  LEFT JOIN worker_switch_metrics wsm ON wsm.worker_id = wtm.worker_id
)
SELECT worker_id, display_name, workspace_id, active_tasks, context_switches_today,
       blocked_tasks, review_tasks, critical_deadline_tasks, attention_risk_score,
       CASE
         WHEN attention_risk_score >= 80::numeric THEN 'critical'::text
         WHEN attention_risk_score >= 60::numeric THEN 'warning'::text
         ELSE 'ok'::text
       END AS risk_level
FROM scored;

COMMENT ON VIEW public.attention_risk_pulse IS
  'A-11 attention risk. SUB-01 (140): подзадачи исключены из active/blocked/review/critical счётчиков (parent_task_id IS NULL) — нагрузку наследует родитель. context_switches_today оставлен по всем задачам: смена статуса подзадачи — реальное действие человека.';

-- ---------------------------------------------------------------------------
-- Вьюха 2/4. review_backlog
--
-- «У этого ревьюера больше 2 задач на проверке» → Risk Pulse «Процессы».
-- Подзадача на проверке — это проверка пункта внутри задачи, а не отдельная
-- единица работы ревьюера. Без фильтра один родитель с 3 подзадачами в
-- review дал бы ложный сигнал перегруза ревьюера.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.review_backlog AS
SELECT t.reviewer_id,
       w.display_name AS reviewer_name,
       count(t.id) AS review_count,
       t.workspace_id
FROM tasks t
JOIN workers w ON w.id = t.reviewer_id AND w.workspace_id = t.workspace_id
WHERE t."column" = 'review'
  -- SUB-01 (140): подзадачи не самостоятельные задачи
  AND t.parent_task_id IS NULL
GROUP BY t.reviewer_id, w.display_name, t.workspace_id
HAVING count(t.id) > 2;

COMMENT ON VIEW public.review_backlog IS
  'Ревьюер с >2 задачами в review. SUB-01 (140): подзадачи исключены — проверка пункта не создаёт отдельной единицы нагрузки на ревьюера.';

-- ---------------------------------------------------------------------------
-- Вьюха 3/4. stuck_tasks
--
-- «Задача в in_progress/review дольше 72ч». Подзадача — небольшой пункт,
-- 72ч на ней — нормальная величина, а не застревание. Оставься бы она в
-- Risk Pulse, то каждая подзадача в работе через 3 дня поднимала бы
-- тревогу, которую нельзя закрыть, не закрыв родителя.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stuck_tasks AS
SELECT t.id, t.title, t."column", t.assigned_to,
       w.display_name AS assignee_name,
       t.moved_to_column_at,
       (EXTRACT(epoch FROM (now() - t.moved_to_column_at)) / 3600)::numeric AS hours_stuck,
       t.workspace_id
FROM tasks t
JOIN workers w ON w.id = t.assigned_to AND w.workspace_id = t.workspace_id
WHERE t."column" = ANY (ARRAY['in_progress','review'])
  AND t.moved_to_column_at < now() - INTERVAL '72 hours'
  AND t.is_blocked = false
  -- SUB-01 (140): подзадачи не самостоятельные задачи
  AND t.parent_task_id IS NULL;

COMMENT ON VIEW public.stuck_tasks IS
  'Задача в работе/на проверке дольше 72ч. SUB-01 (140): подзадачи исключены — пункт на 72ч не считается застреванием.';

-- ---------------------------------------------------------------------------
-- Вьюха 4/4. bottleneck_columns
--
-- Сравнение счётчика колонки с WIP-лимитом. Подзадачи — работа внутри
-- задачи, а не поток в колонке: их вклад в WIP иначе завышал бы
-- «Перегрузка колонки» для задачи, которая вполне в норме.
--
-- Фильтр в ON, а не в WHERE: LEFT JOIN должен остаться LEFT JOIN, иначе
-- колонки без задач исчезли бы из вьюхи.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.bottleneck_columns AS
SELECT c.workspace_id,
       c.name AS column_name,
       c.wip_limit,
       m.val AS multiplier,
       count(t.id) AS task_count,
       CASE
         WHEN count(t.id)::double precision > (c.wip_limit * m.val) THEN 'critical'::text
         WHEN count(t.id) > c.wip_limit THEN 'warning'::text
         ELSE 'ok'::text
       END AS severity
FROM tracker.columns c
JOIN workspace_settings ws ON ws.workspace_id = c.workspace_id
LEFT JOIN tasks t ON (
  t."column" = c.name
  AND t.workspace_id = c.workspace_id
  AND t."column" <> 'done'
  -- SUB-01 (140): подзадачи не создают потока в колонке
  AND t.parent_task_id IS NULL
)
LEFT JOIN LATERAL (
  SELECT COALESCE(
    CASE
      WHEN ws.flow_config ->> 'wip_alert_multiplier' ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (ws.flow_config ->> 'wip_alert_multiplier')::double precision
      ELSE NULL::double precision
    END, 1.5::double precision) AS val
) m ON true
WHERE c.wip_limit IS NOT NULL
GROUP BY c.id, c.name, c.wip_limit, c.workspace_id, m.val
HAVING count(t.id) > c.wip_limit;

COMMENT ON VIEW public.bottleneck_columns IS
  'Колонка за WIP-лимитом. SUB-01 (140): подзадачи исключены (фильтр в ON, чтобы LEFT JOIN остался LEFT JOIN) — вклад подзадач не считается потоком в колонке.';

-- ============================================================================
-- Верификация части 1
--   SELECT count(*) FROM public.attention_risk_pulse;  -- до/после равны (подзадач в проде нет)
--   SELECT count(*) FROM public.review_backlog;
--   SELECT count(*) FROM public.stuck_tasks;
--   SELECT count(*) FROM public.bottleneck_columns;
--   Поведенческая проверка фильтра — часть 2 (миграция 141), там же
--   создаётся тестовая подзадача и сверяются счётчики.
-- ============================================================================
