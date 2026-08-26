-- ============================================================================
-- Migration 059: mcp_agent_keys.playbook_variant — high/lite duty playbook
--   variant per key (CTX-03 / "light full vs heavy full").
--
-- Проблема: встроенный full-плейбук (~45 правил, ~1.9k токенов) рассчитан на
--   флагманские модели. Малые модели (класс Qwen3-A3B и ниже) стабильно
--   нарушают протокол: пропускают claim, ускоряют завершение, теряют
--   мета-обязательства — наблюдено в проде.
-- Решение: ортогональный уровню автономии выбор варианта плейбука на ключе:
--   'high' (дефолт) — полный протокол для сильных моделей;
--   'lite'          — плоский чек-лист (~16 правил): ядро цикла + ack +
--                     деплой с единственным guard'ом; редкие ветки
--                     (409/quota/subgraph-pre-check/домен деплоя) заменены
--                     на escalate_task человеку (fail-loud вместо тихого
--                     неверного шага).
-- Права НЕ меняются: allowed_tools по-прежнему определяются autonomy_level.
-- Ресолв: resolveDutyPlaybook(level, stored, variant) — override ключ
--   "<level>_lite" в workspace_settings.agent_duty_playbook, иначе builtin.
-- ============================================================================

ALTER TABLE public.mcp_agent_keys
  ADD COLUMN IF NOT EXISTS playbook_variant text NOT NULL DEFAULT 'high';

ALTER TABLE public.mcp_agent_keys DROP CONSTRAINT IF EXISTS mcp_agent_keys_playbook_variant_check;
ALTER TABLE public.mcp_agent_keys
  ADD CONSTRAINT mcp_agent_keys_playbook_variant_check
  CHECK (playbook_variant IN ('high', 'lite'));

COMMENT ON COLUMN public.mcp_agent_keys.playbook_variant IS
  'Duty playbook depth for this key: high (full protocol, strong models) or lite (flat checklist for small models - core loop + ack + guarded deploy, rare branches become escalate_task). Orthogonal to autonomy_level; permissions unchanged.';
