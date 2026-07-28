-- ============================================================
-- onitask · Move last_active_workspace_id from workspace_settings to profiles
-- File:    016_move_last_active_workspace_to_profiles.sql
-- Purpose: Переносить "последняя активная доска" из workspace_settings в profiles,
--          так как это пользовательская настройка, а не настройка воркспейса.
-- Date:    2026-07-28
-- ============================================================

-- STEP 1: Добавить колонку в profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_workspace_id uuid REFERENCES public.workspaces(id);

CREATE INDEX IF NOT EXISTS idx_profiles_last_active_workspace
  ON public.profiles (last_active_workspace_id)
  WHERE last_active_workspace_id IS NOT NULL;

-- STEP 2: Перенести существующие данные из workspace_settings.last_active_board_id
-- Для каждого пользователя берём last_active_board_id из его workspace_settings
UPDATE public.profiles p
SET last_active_workspace_id = ws.last_active_board_id
FROM public.workspace_settings ws
WHERE ws.last_active_board_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.source_id = p.id::text
      AND w.workspace_id = ws.workspace_id
      AND w.is_active = true
  );

-- STEP 3: Удалить старую колонку из workspace_settings
ALTER TABLE public.workspace_settings
  DROP COLUMN IF EXISTS last_active_board_id;

-- STEP 4: Удалить старый индекс (будет удалён автоматически при DROP COLUMN, но явно для ясности)
DROP INDEX IF EXISTS idx_workspace_settings_last_active_board;