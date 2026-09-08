-- ============================================================
-- Migration: 079_workers_role_title
-- File:    079_workers_role_title.sql
-- Purpose: Кастомная «Роль в доске» (должность воркера) — текстовое поле.
--          Пресет доступов хранится в существующем workers.role
--          (owner/admin/member), должность — в workers.role_title.
-- Date:    2026-09-08
-- ============================================================

ALTER TABLE public.workers
  ADD COLUMN role_title text CHECK (char_length(role_title) <= 50);

COMMENT ON COLUMN public.workers.role_title IS
  'Кастомная должность воркера на доске («Маркетолог», «Фронтендер»). UI-поле «Роль в доске»; пресет доступов хранится в workers.role. NULL = не задана.';

-- Backfill не требуется: исторически должности не существовали, все строки остаются NULL.
