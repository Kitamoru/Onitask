-- ============================================================
-- onitask · Migration 078
-- File:    078_workspace_settings_backfill_and_trigger.sql
-- Purpose: Guarantee INV-08 (workspace_settings = single source of truth
--          for workspace settings) at the DB level.
--
-- Root cause:
--   Migration 042 dropped workspace_settings.mcp_api_keys, but
--   POST /api/workspaces still inserted mcp_api_keys = {} -> INSERT failed
--   (PGRST204), the error was swallowed (console.error), leaving workspaces
--   with NO settings row -> /api/ai/create-task failed with `.single()`
--   -> "Не удалось загрузить настройки".
--
-- Fixes:
--   1. AFTER INSERT trigger init_workspace_settings() inserts a default
--      settings row (ON CONFLICT DO NOTHING) so no workspace is ever
--      created without settings -- atomic with workspaces INSERT
--      (matches trg_init_task_counter / trg_init_workspace_columns).
--   2. Backfill: create settings rows for existing workspaces missing one.
--   3. Route Handler must drop mcp_api_keys payload + use upsert (code edit).
--
-- Run AFTER 042 and 076.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.init_workspace_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $_$
BEGIN
  INSERT INTO public.workspace_settings (
    workspace_id, story_points_config, enable_cognitive_budget,
    workspace_context, deadline_signals, velocity_window_days,
    flow_config, realtime_subscription_level, data_sharing_level,
    quota_config, standup_config, doc_kb_config, f04_config
  )
  VALUES (
    NEW.id,
    '{"enabled":false}',
    false,
    NULL,
    '[{"value":3,"label":"3 дня","level":"amber"},{"value":1,"label":"1 день","level":"red"}]',
    14,
    '{}',
    'own_tasks',
    'standard',
    '{"agent_reserved_pct":60,"human_min_pct":40}',
    '{"enabled":false,"time_utc":"07:00","chat_id":null}',
    '{"enabled":true,"max_file_bytes":524288,"max_total_bytes":5242880,"max_files":20}',
    '{"skip_min_clarity":0.85,"skip_max_complexity":1,"correction_sheet_clarity_threshold":0.70,"low_clarity_tag_threshold":0.55}'
  )
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$_$;

DROP TRIGGER IF EXISTS trg_init_workspace_settings ON public.workspaces;

CREATE TRIGGER trg_init_workspace_settings
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.init_workspace_settings();

COMMENT ON TRIGGER trg_init_workspace_settings ON public.workspaces IS
  'INV-08: every workspace has a workspace_settings row (defaulted on INSERT)';

-- ---------------------------------------------------------------------------
-- 2. Backfill existing workspaces missing a settings row (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.workspace_settings (
  workspace_id, story_points_config, enable_cognitive_budget,
  workspace_context, deadline_signals, velocity_window_days,
  flow_config, realtime_subscription_level, data_sharing_level,
  quota_config, standup_config, doc_kb_config, f04_config
)
SELECT
  w.id,
  '{"enabled":false}',
  false,
  NULL,
  '[{"value":3,"label":"3 дня","level":"amber"},{"value":1,"label":"1 день","level":"red"}]',
  14,
  '{}',
  'own_tasks',
  'standard',
  '{"agent_reserved_pct":60,"human_min_pct":40}',
  '{"enabled":false,"time_utc":"07:00","chat_id":null}',
  '{"enabled":true,"max_file_bytes":524288,"max_total_bytes":5242880,"max_files":20}',
  '{"skip_min_clarity":0.85,"skip_max_complexity":1,"correction_sheet_clarity_threshold":0.70,"low_clarity_tag_threshold":0.55}'
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_settings ws WHERE ws.workspace_id = w.id
);
