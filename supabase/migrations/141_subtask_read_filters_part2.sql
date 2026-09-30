-- ============================================================================
-- 141_subtask_read_filters_part2.sql
-- onitask · SUB-01: подзадачи не видны агрегатам (часть 2 из 2)
--
-- Продолжение 140. Те же правила (см. заголовок 140):
--   · подзадачи не самостоятельные задачи;
--   · нагрузку наследует родитель (решение владельца по A-9);
--   · видимы только в стриме и внутри карточки родителя.
--
-- Здесь: overloaded_workers, pending_escalations, orphan_blockers,
-- stale_blocked + get_workspace_operational_context() + deadline_notify_tick().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Вьюха 5/8. overloaded_workers
--
-- Порог здесь flow_config.overload_threshold (default 6), а не шкала
-- F-01 (>=3) — расхождение задокументировано в Master §6.4 как отдельная
-- задача. Здесь правится только состав задач, порог не трогаем.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.overloaded_workers AS
WITH worker_load AS (
  SELECT w.id, w.display_name, w.workspace_id,
         COALESCE(sum(COALESCE(t.cognitive_weight, 1)), 0)::bigint AS total_load,
         COALESCE(
           CASE
             WHEN ws.flow_config ->> 'overload_threshold' ~ '^[0-9]+$'
               THEN (ws.flow_config ->> 'overload_threshold')::integer
             ELSE NULL::integer
           END, 6) AS threshold
  FROM workers w
  JOIN workspace_settings ws ON ws.workspace_id = w.workspace_id
  LEFT JOIN tasks t ON (
    ((t.assigned_to = w.id AND t."column" = 'in_progress')
     OR (t.reviewer_id = w.id AND t."column" = 'review'))
    AND t.is_blocked = false
    AND t.is_inbox = false
    AND t.workspace_id = w.workspace_id
    -- SUB-01 (141): подзадачи не создают нагрузки
    AND t.parent_task_id IS NULL
  )
  WHERE w.type = 'human'
  GROUP BY w.id, w.display_name, w.workspace_id, ws.flow_config
)
SELECT id, display_name, workspace_id, total_load, threshold
FROM worker_load
WHERE total_load > threshold;

COMMENT ON VIEW public.overloaded_workers IS
  'Перегруженные по flow_config.overload_threshold. SUB-01 (141): подзадачи исключены из LEFT JOIN tasks — нагрузку наследует родитель. Порог (default 6) не менялся: расхождение со шкалой F-01 — отдельная задача (Master §6.4).';

-- ---------------------------------------------------------------------------
-- Вьюха 6/8. pending_escalations
--
-- needs_human на подзадаче = эскалация пункта. Это НЕ шум: застрявшая
-- подзадача блокирует родителя, и оператору нужно видеть её в очереди.
-- В отличие от метрик нагрузки, эскалация — событие, а не накопитель.
-- Поэтому подзадачи ЗДЕСЬ ОСТАВЛЯЕМ осознанно.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Вьюха 7/8. orphan_blockers
--
-- Подзадача без блокеров в orphan_blockers не попадает: у неё нет
-- task_relations. Фильтр добавлен для единообразия и как защита: если
-- владелец позже разрешит блокировать подзадачи, фантомная блокировка
-- пункта не должна была бы попадать в Risk Pulse.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.orphan_blockers AS
SELECT t.id, t.title, t."column", t.workspace_id, t.assigned_to,
       w.display_name AS assignee_name,
       t.moved_to_column_at,
       (EXTRACT(epoch FROM (now() - t.moved_to_column_at)) / 3600)::numeric AS hours_blocked
FROM tasks t
LEFT JOIN workers w ON w.id = t.assigned_to AND w.workspace_id = t.workspace_id
WHERE t.is_blocked = true
  AND t."column" <> 'done'
  -- SUB-01 (141): подзадачи не самостоятельные задачи
  AND t.parent_task_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM task_relations tr
    JOIN tasks blocker ON blocker.id = tr.from_task_id
    WHERE tr.to_task_id = t.id
      AND tr.relation_type = 'blocks'
      AND tr.workspace_id = t.workspace_id
      AND blocker."column" <> 'done'
  );

COMMENT ON VIEW public.orphan_blockers IS
  'Заблокирована, но все блокеры в done. SUB-01 (141): подзадачи исключены; pending_escalations, наоборот, подзадачи ОСТАВЛЯЕТ — эскалация пункта блокирует родителя, и оператор должен её видеть.';

-- ---------------------------------------------------------------------------
-- Вьюха 8/8. stale_blocked
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stale_blocked AS
SELECT id, title, "column", assigned_to, workspace_id, moved_to_column_at
FROM tasks
WHERE is_blocked = true
  AND moved_to_column_at < now() - INTERVAL '48 hours'
  AND "column" <> 'done'
  -- SUB-01 (141): подзадачи не самостоятельные задачи
  AND parent_task_id IS NULL;

COMMENT ON VIEW public.stale_blocked IS
  'Заблокирована дольше 48ч. SUB-01 (141): подзадачи исключены.';

-- ---------------------------------------------------------------------------
-- get_workspace_operational_context() — контекст для LLM (F-04/F-03)
--
-- ЭТО САМЫЙ ВАЖНЫЙ ФИЛЬТР ИЗ ВСЕХ. Функция уходит в промт: агент и F-04
-- видят «overloaded_workers» и «active_tasks» и принимают решения по ним.
-- Если в списке активных задач окажутся подзадачи, модель начнёт считать
-- объём работ по пунктам одной задачи — то есть принимать решения по данным,
-- которых человек в UI не видит. Согласованность обязательна: что модель
-- считает нагрузкой, должно совпадать с тем, что видит Flow Board.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_workspace_operational_context(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'sprint', (
      SELECT jsonb_build_object('name', s.name, 'goal', s.goal, 'status', s.status)
      FROM public.sprints s
      WHERE s.workspace_id = p_workspace_id AND s.status = 'active'
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'overloaded_workers', COALESCE((
      SELECT jsonb_agg(w.display_name ORDER BY load.total DESC)
      FROM (
        SELECT l.worker_id, SUM(l.weight)::int AS total
        FROM (
          SELECT t.assigned_to AS worker_id, COALESCE(t.cognitive_weight, 1) AS weight
          FROM public.tasks t
          WHERE t.workspace_id = p_workspace_id
            AND t.is_inbox = false AND t."column" = 'in_progress'
            AND t.assigned_to IS NOT NULL
            AND t.parent_task_id IS NULL
          UNION ALL
          SELECT t.reviewer_id AS worker_id, COALESCE(t.cognitive_weight, 1) AS weight
          FROM public.tasks t
          WHERE t.workspace_id = p_workspace_id
            AND t.is_inbox = false AND t."column" = 'review'
            AND t.reviewer_id IS NOT NULL
            AND t.parent_task_id IS NULL
        ) l
        GROUP BY l.worker_id
        HAVING SUM(l.weight) >= 3
      ) load
      JOIN public.workers w ON w.id = load.worker_id
      WHERE w.is_active = true
    ), '[]'::jsonb),
    'escalations', (
      SELECT count(*) FROM public.pending_escalations pe
      WHERE pe.workspace_id = p_workspace_id
    ),
    'blockers', (
      SELECT count(*) FROM public.orphan_blockers ob
      WHERE ob.workspace_id = p_workspace_id
    ),
    'active_tasks', (
      SELECT count(*) FROM public.tasks t
      WHERE t.workspace_id = p_workspace_id
        AND t.is_inbox = false
        AND t."column" IN ('in_progress', 'review')
        AND t.parent_task_id IS NULL
    )
  );
$function$;

COMMENT ON FUNCTION public.get_workspace_operational_context(uuid) IS
  'Операционный контекст для LLM. SUB-01 (141): подзадачи исключены из overloaded_workers и active_tasks — иначе модель считала бы объём по пунктам одной задачи и получала данные, которых человек в UI не видит. escalations/blockers берутся из вьюх, где фильтр уже стоит.';

-- ---------------------------------------------------------------------------
-- deadline_notify_tick() — уведомления о сроках (BOT-11)
--
-- Решение владельца: подзадачи исключены. У родителя и подзадачи обычно
-- один и тот же дедлайн, и без фильтра исполнитель получил бы два
-- одинаковых уведомления в один день — дедуп task_deadline_notifications
-- ведёт счёт по task_id, то есть по разным строкам, и не спасает.
--
-- Красная подсветка просроченной подзадачи в карточке родителя (SUB-05)
-- считается на клиенте из её собственного deadline, отдельным путём.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deadline_notify_tick(p_batch int DEFAULT 200)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Europe/Moscow')::date;
  v_emitted   int := 0;
  v_tdn_id    uuid;
  r           record;
  v_days_left int;
  v_amber     int;
  v_red       int;
  v_kind      text;
BEGIN
  FOR r IN
    SELECT t.id, t.workspace_id, t.deadline, t.task_number,
           t.created_by, t.assigned_to,
           w.task_prefix,
           ws.deadline_signals
    FROM public.tasks t
    JOIN public.workspaces w          ON w.id = t.workspace_id
    JOIN public.workspace_settings ws ON ws.workspace_id = t.workspace_id
    WHERE t.deadline IS NOT NULL
      AND t."column" != 'done'
      AND t.is_inbox = false
      AND t.parent_task_id IS NULL
      AND ws.deadline_signals IS NOT NULL
      AND jsonb_typeof(ws.deadline_signals) = 'array'
    ORDER BY t.deadline
    LIMIT GREATEST(COALESCE(p_batch, 200), 1)
  LOOP
    v_amber := (
      SELECT (elem ->> 'value')::int
      FROM jsonb_array_elements(r.deadline_signals) elem
      WHERE elem ->> 'level' = 'amber'
      LIMIT 1
    );
    v_red := (
      SELECT (elem ->> 'value')::int
      FROM jsonb_array_elements(r.deadline_signals) elem
      WHERE elem ->> 'level' = 'red'
      LIMIT 1
    );
    v_amber := COALESCE(v_amber, 3);
    v_red   := COALESCE(v_red, 1);

    v_days_left := (r.deadline AT TIME ZONE 'Europe/Moscow')::date - v_today;

    IF v_days_left < 0 THEN
      v_kind := 'overdue';
    ELSIF v_days_left <= v_red THEN
      v_kind := 'red';
    ELSIF v_days_left <= v_amber THEN
      v_kind := 'amber';
    ELSE
      CONTINUE;
    END IF;

    IF v_kind = 'amber' THEN
      INSERT INTO public.task_deadline_notifications (task_id, workspace_id, kind)
      VALUES (r.id, r.workspace_id, 'amber')
      ON CONFLICT (task_id) WHERE kind = 'amber' DO NOTHING
      RETURNING id INTO v_tdn_id;
    ELSIF v_kind = 'red' THEN
      INSERT INTO public.task_deadline_notifications (task_id, workspace_id, kind)
      VALUES (r.id, r.workspace_id, 'red')
      ON CONFLICT (task_id, notified_on) WHERE kind = 'red' DO NOTHING
      RETURNING id INTO v_tdn_id;
    ELSE
      INSERT INTO public.task_deadline_notifications (task_id, workspace_id, kind)
      VALUES (r.id, r.workspace_id, 'overdue')
      ON CONFLICT (task_id) WHERE kind = 'overdue' DO NOTHING
      RETURNING id INTO v_tdn_id;
    END IF;

    IF v_tdn_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      r.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type', 'deadline_approaching',
        'task_id',    r.id,
        'full_id',    COALESCE(r.task_prefix || '-' || r.task_number::text, r.id::text),
        'hours_left', round(EXTRACT(EPOCH FROM (r.deadline - now())) / 3600.0),
        'level',      v_kind,
        'created_by', r.created_by,
        'assigned_to', r.assigned_to
      )
    );
    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN v_emitted;
END;
$fn$;

COMMENT ON FUNCTION public.deadline_notify_tick(int) IS
  'BOT-11 ежедневный тик светофора (09:00 МСК). SUB-01 (141): подзадачи исключены — дедлайн обычно общий с родителем, дедуп по task_id дубли не снимает. Просрочка подзадачи показывается в карточке родителя (клиент, SUB-05).';

-- ============================================================================
-- Верификация части 2
--   SELECT count(*) FROM public.overloaded_workers;   -- 0 до и после
--   SELECT count(*) FROM public.pending_escalations;  -- не изменилась (фильтра нет)
--   SELECT count(*) FROM public.orphan_blockers;      -- 0
--   SELECT count(*) FROM public.stale_blocked;        -- 0
--   SELECT public.get_workspace_operational_context('<ws_uuid>');
--   SELECT public.deadline_notify_tick();  -- повторный прогон = 0 (дедуп)
-- ============================================================================
