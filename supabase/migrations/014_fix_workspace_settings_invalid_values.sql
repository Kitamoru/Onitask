-- ============================================================
-- onitask · Migration 014 — Fix invalid workspace_settings values
-- File:    014_fix_workspace_settings_invalid_values.sql
-- Purpose: Исправить невалидные значения data_sharing_level и realtime_subscription_level
--          которые нарушают check-ограничения БД (ошибка 23514).
-- Date:    2026-07-28
-- ============================================================

-- Исправить data_sharing_level = 'none' → 'standard'
UPDATE public.workspace_settings
SET data_sharing_level = 'standard'
WHERE data_sharing_level NOT IN ('minimal', 'standard', 'full');

-- Исправить realtime_subscription_level = 'full' → 'own_tasks'
UPDATE public.workspace_settings
SET realtime_subscription_level = 'own_tasks'
WHERE realtime_subscription_level NOT IN ('own_tasks', 'all');