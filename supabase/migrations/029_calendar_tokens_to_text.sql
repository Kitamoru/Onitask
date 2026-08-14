-- Migration: calendar_connections — удалить encrypted_oauth_tokens bytea
-- Причина: переход на oauth_tokens_b64 text(base64) для надёжного декодирования.
-- Старый столбец больше не используется.

-- ═══════════════════════════════════════════════════════
-- 1. Удаляем deprecated столбец
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.calendar_connections
  DROP COLUMN IF EXISTS encrypted_oauth_tokens;

-- ═══════════════════════════════════════════════════════
-- 2. oauth_tokens_b64 уже NOT NULL из миграции 028
-- ═══════════════════════════════════════════════════════