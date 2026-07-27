-- ============================================================
-- Migration 012: Add sprint_enabled to story_points_config
-- Date: 2026-07-27
-- Purpose: Добавить тоггл "Активировать спринт" в workspace_settings
-- ============================================================

-- Обновляем существующие записи, добавляя sprint_enabled = false
UPDATE public.workspace_settings
SET story_points_config = jsonb_set(
  COALESCE(story_points_config, '{"enabled": false}'::jsonb),
  '{sprint_enabled}',
  'false'::jsonb
)
WHERE story_points_config IS NULL
   OR NOT (story_points_config ? 'sprint_enabled');