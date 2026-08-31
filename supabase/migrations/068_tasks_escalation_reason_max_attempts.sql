-- ============================================================================
-- 068_tasks_escalation_reason_max_attempts.sql
-- Architecture 0.9 (док. 09, Reaper retry policy):
--   Расширяем tasks_escalation_reason_check значением 'max_attempts' —
--   причина эскалации рипера после 3 неудачных попыток (VT-истечений).
--   Существующие значения (insufficient_context, conflicting_requirements,
--   blocked_by, out_of_scope) сохранены.
-- Применено 2026-08-31.
-- ============================================================================

ALTER TABLE public.tasks DROP CONSTRAINT tasks_escalation_reason_check;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_escalation_reason_check
  CHECK (escalation_reason = ANY (ARRAY[
    'insufficient_context'::text,
    'conflicting_requirements'::text,
    'blocked_by'::text,
    'out_of_scope'::text,
    'max_attempts'::text
  ]));