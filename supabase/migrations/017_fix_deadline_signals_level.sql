-- ============================================================
-- onitask · Migration 017
-- File:    017_fix_deadline_signals_level.sql
-- Version: 0.13.5
-- Date:    2026-07-29
-- Purpose: Исправить deadline_signals без поля `level` (amber/red)
--          Пер migration 007 spec: [{ value, label, level }]
--          Некоторые записи были созданы без level — добавляем.
-- ============================================================

-- Для каждой записи: если deadline_signals не содержит level, добавляем его
-- Предполагаем: первый элемент = amber (warning), второй = red (urgent)
UPDATE public.workspace_settings
SET deadline_signals = (
  SELECT jsonb_agg(
    CASE
      WHEN ord = 0 THEN elem || '{"level": "amber"}'::jsonb
      WHEN ord = 1 THEN elem || '{"level": "red"}'::jsonb
      ELSE elem || '{"level": "amber"}'::jsonb
    END
  )
  FROM jsonb_array_elements(deadline_signals) WITH ORDINALITY AS t(elem, ord)
  WHERE NOT (elem ? 'level')
)
WHERE deadline_signals IS NOT NULL
  AND jsonb_typeof(deadline_signals) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(deadline_signals) AS elem
    WHERE NOT (elem ? 'level')
  );

-- Верификация:
-- SELECT workspace_id, deadline_signals
-- FROM public.workspace_settings
-- WHERE deadline_signals IS NOT NULL;