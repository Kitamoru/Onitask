-- ============================================================
-- onitask · Migration 090
-- File:    090_deadline_notifications.sql
-- Date:    2026-09-21
--
-- Уведомления по «сигналам светофора» (пороги дедлайнов из
-- workspace_settings.deadline_signals, миграция 007).
--
-- Семантика (утверждена 2026-09-21):
--   amber (warningDays) — 1 раз на задачу при входе в жёлтую зону;
--   red (urgentDays)    — ежедневно в 09:00 МСК до самого дедлайна;
--   overdue             — 1 раз на задачу после просрочки.
--
-- Тик: public.deadline_notify_tick() → enrichment_queue (type='bot_notify',
-- alert_type='deadline_approaching') → Edge Function bot-notify → DM
-- постановщику + исполнителю. Дедуп — task_deadline_notifications
-- (частичные уникальные индексы), «не более раза в сутки» по джобу.
--
-- Cron: 09:00 МСК = '0 6 * * *' UTC (MSK = UTC+3, фиксированное смещение).
-- Регистрируется ВРУЧНУЮ (роль миграций не имеет прав на cron.job, as-built
-- паттерн 067/073):
--   SELECT cron.unschedule('deadline-notify-tick');  -- при перерегистрации
--   SELECT cron.schedule('deadline-notify-tick', '0 6 * * *',
--     $$SELECT public.deadline_notify_tick()$$);
-- ============================================================

-- ═══════════════════════════════════════════════════════
-- 1. Таблица-журнал дедупликации task_deadline_notifications
-- ═══════════════════════════════════════════════════════
CREATE TABLE public.task_deadline_notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('amber', 'red', 'overdue')),
  notified_on  date        NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Moscow')::date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- amber: одно уведомление на задачу
CREATE UNIQUE INDEX uq_tdn_amber_once
  ON public.task_deadline_notifications (task_id)
  WHERE kind = 'amber';
-- red: не более одного в сутки на задачу
CREATE UNIQUE INDEX uq_tdn_red_daily
  ON public.task_deadline_notifications (task_id, notified_on)
  WHERE kind = 'red';
-- overdue: одно уведомление на задачу
CREATE UNIQUE INDEX uq_tdn_overdue_once
  ON public.task_deadline_notifications (task_id)
  WHERE kind = 'overdue';

CREATE INDEX idx_tdn_workspace
  ON public.task_deadline_notifications (workspace_id, kind);
-- G4/advisor: покрывающий индекс FK task_id
CREATE INDEX idx_tdn_task
  ON public.task_deadline_notifications (task_id);

ALTER TABLE public.task_deadline_notifications ENABLE ROW LEVEL SECURITY;
-- RLS без политик = service-only (паттерн dispatch_outbox, миг. 060).

COMMENT ON TABLE public.task_deadline_notifications IS
  'Dedup journal for deadline traffic-light notifications (090): amber once per task, red once per day, overdue once per task. Written by deadline_notify_tick(). RLS service-only.';

-- ═══════════════════════════════════════════════════════
-- 2. Функция-тик deadline_notify_tick
-- ═══════════════════════════════════════════════════════
-- Зоны (days_left = дата дедлайна в МСК − сегодня):
--   overdue: days_left < 0
--   red:     0 <= days_left <= urgentDays
--   amber:   urgentDays < days_left <= warningDays
-- Отсутствие level в deadline_signals → дефолты миграции 007 (amber=3, red=1).
-- deadline_signals IS NULL (светофор выключен) → workspace пропускается.
CREATE OR REPLACE FUNCTION public.deadline_notify_tick(p_batch int DEFAULT 200)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- Дефолты миграции 007, если level не проставлен
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

    -- Дедуп + emit атомарно: RETURNING срабатывает только при фактической вставке
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
      CONTINUE;  -- уже уведомляли (amber/overdue once, red — сегодня)
    END IF;

    INSERT INTO public.enrichment_queue (workspace_id, type, payload)
    VALUES (
      r.workspace_id,
      'bot_notify',
      jsonb_build_object(
        'alert_type', 'deadline_approaching',
        'task_id',    r.id,
        'full_id',    COALESCE(
                        r.task_prefix || '-' || r.task_number::text,
                        r.id::text),
        'hours_left', round(
                        EXTRACT(EPOCH FROM (r.deadline - now())) / 3600.0),
        'level',      v_kind,
        'created_by', r.created_by,
        'assigned_to', r.assigned_to
      )
    );
    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN v_emitted;
END;
$$;

COMMENT ON FUNCTION public.deadline_notify_tick IS
  'Daily deadline traffic-light tick (09:00 MSK cron): dedup via task_deadline_notifications, emits enrichment_queue bot_notify jobs with alert_type=deadline_approaching. Recipients resolved by bot-notify (creator + assignee).';

-- ═══════════════════════════════════════════════════════
-- Верификация (запустить после применения):
--   SELECT id, task_id, kind, notified_on FROM public.task_deadline_notifications LIMIT 1;
--   SELECT public.deadline_notify_tick();  -- ручной прогон: вернёт число эмитнутых
-- Повторный прогон должен вернуть 0 (дедуп работает).
-- ═══════════════════════════════════════════════════════