-- ============================================================
-- Migration 012: Add sprint_enabled to story_points_config
-- Date: 2026-07-27
-- Purpose: Добавить тоггл "Активировать спринт" в workspace_settings
-- ============================================================

-- Добавляем sprint_enabled = false в существующие записи (безопасно: не перезаписывает другие поля)
UPDATE public.workspace_settings
SET story_points_config = jsonb_set(story_points_config, '{sprint_enabled}', 'false'::jsonb)
WHERE story_points_config IS NOT NULL
  AND NOT (story_points_config ? 'sprint_enabled');

-- Для записей где story_points_config IS NULL — создаём с default значением
UPDATE public.workspace_settings
SET story_points_config = '{"enabled": false, "sprint_enabled": false}'::jsonb
WHERE story_points_config IS NULL;