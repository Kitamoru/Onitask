-- ============================================================
-- onitask · Migration 018
-- File:    018_fix_deadline_signals_level_swap.sql
-- Version: 0.13.5
-- Date:    2026-07-29
-- Purpose: Исправить перепутанные level в deadline_signals после миграции 017
--          value=3 должно быть amber, value=1 должно быть red
-- ============================================================

UPDATE public.workspace_settings
SET deadline_signals = (
  SELECT jsonb_agg(
    CASE
      WHEN (elem ->> 'value')::int >= 2 THEN elem || '{"level": "amber"}'::jsonb
      WHEN (elem ->> 'value')::int <= 1 THEN elem || '{"level": "red"}'::jsonb
      ELSE elem
    END
  )
  FROM jsonb_array_elements(deadline_signals) AS elem
)
WHERE deadline_signals IS NOT NULL
  AND jsonb_typeof(deadline_signals) = 'array';

-- Верификация:
-- SELECT workspace_id, deadline_signals
-- FROM public.workspace_settings
-- WHERE deadline_signals IS NOT NULL;