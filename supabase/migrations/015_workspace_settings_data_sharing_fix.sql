-- ============================================================
-- onitask · Migration 015 — Fix workspace_settings check constraint violations
-- File:    015_workspace_settings_data_sharing_fix.sql
-- Purpose: Guarantee all existing workspace_settings rows have
--          valid data_sharing_level and realtime_subscription_level values.
-- Date:    2026-07-28
-- ============================================================

-- Fix any invalid data_sharing_level values (e.g., 'none' → 'standard')
UPDATE public.workspace_settings
SET data_sharing_level = 'standard'
WHERE data_sharing_level NOT IN ('minimal', 'standard', 'full');

-- Fix any invalid realtime_subscription_level values (e.g., 'full' → 'own_tasks')
UPDATE public.workspace_settings
SET realtime_subscription_level = 'own_tasks'
WHERE realtime_subscription_level NOT IN ('own_tasks', 'all');

-- Verify
SELECT workspace_id, data_sharing_level, realtime_subscription_level
FROM public.workspace_settings;