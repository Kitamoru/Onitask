-- ============================================================
-- onitask · Migration 007
-- File:    007_workspace_links_and_deadline_signals.sql
-- Version: 0.13.5
-- Date:    2026-07-15
-- Master:  onitask_Architecture_Master_.md v0.13.4 (patch)
--
-- Добавляет:
--   1. Таблицу workspace_links — внешние ссылки команды (figma, db, github и т.д.)
--   2. Поле deadline_signals в workspace_settings — пороги уведомлений о дедлайнах
--
-- Оба изменения используются BoardForm.tsx при создании workspace.
-- Патч безопасен: ADD COLUMN с DEFAULT не блокирует чтение,
-- новая таблица не затрагивает существующие данные.
-- ============================================================

-- ═══════════════════════════════════════════════════════
-- 1. Таблица workspace_links
-- ═══════════════════════════════════════════════════════
-- Внешние ссылки команды: Figma, база данных, GitHub и т.д.
-- Паттерн идентичен workspace_telegram_chats — маленькая lookup-таблица
-- с created_by/created_at, не jsonb-блок в workspace_settings.

CREATE TABLE public.workspace_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  url          text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
  created_by   uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_links_workspace
  ON public.workspace_links (workspace_id);

-- ═══════════════════════════════════════════════════════
-- 2. Поле deadline_signals в workspace_settings
-- ═══════════════════════════════════════════════════════
-- Пороги уведомлений о дедлайнах для bot_notify алертов.
-- Структура: [{ value: number (дни), label: string, level: 'amber'|'red' }]
-- Дефолт: 3 дня (amber) + 1 день (red).
-- Используется lib/urgency.ts (getUrgency) и Edge Function bot-notify.

ALTER TABLE public.workspace_settings
ADD COLUMN deadline_signals jsonb DEFAULT '[
  {"value": 3, "label": "3 дня", "level": "amber"},
  {"value": 1, "label": "1 день", "level": "red"}
]';

-- ═══════════════════════════════════════════════════════
-- Верификация (запустить после применения):
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'workspace_links' OR table_name = 'workspace_settings';
-- ═══════════════════════════════════════════════════════