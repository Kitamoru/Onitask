-- ============================================================================
-- 065_human_override_trigger.sql
-- Architecture 0.9 ADR R8: Human moves task while claim open → force-close
-- execution via DB trigger (предпочтительнее route-only checks).
--
-- G5-интерplay: НЕ пишем version вручную (bump_task_version 046 сделает это
-- для любого UPDATE). Триггер меняет только active_claim_id и закрывает
-- execution. Порядок с триггерами не критичен (BEFORE UPDATE OF "column").
--
-- Оps-мутации (ops_lease/ops_terminal/ops_nack) идут с
-- set_config('onitask.ops_mutation','1',true) — триггер их пропускает.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_tasks_human_override_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Только если есть открытый claim
  IF OLD.active_claim_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ops-пути (lease/terminal/nack) — не человеческие мутации
  IF current_setting('onitask.ops_mutation', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Форс-закрытие только при реальном изменении рабочей колонки
  IF NEW."column" IS DISTINCT FROM OLD."column" THEN
    UPDATE public.task_executions
      SET status = 'closed',
          terminal_outcome = NULL,
          summary = coalesce(summary, '') || ' [human_override]',
          closed_at = now(),
          metadata = metadata || jsonb_build_object('close_reason', 'human_override')
      WHERE id = OLD.active_claim_id AND status = 'open';

    NEW.active_claim_id := NULL;
    -- версия НЕ трогаем: bump_task_version (046) инкрементирует сам (G5)
    NEW.moved_to_column_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_human_override_claim ON public.tasks;
CREATE TRIGGER trg_tasks_human_override_claim
  BEFORE UPDATE OF "column" ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_tasks_human_override_claim();

COMMENT ON FUNCTION public.trg_tasks_human_override_claim IS
  'R8: человеческий перенос колонки при открытом claim → execution force-closed (human_override), active_claim_id NULL, version инкрементится 046. Ops-пути пропускаются через onitask.ops_mutation.';