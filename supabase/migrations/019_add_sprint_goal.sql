-- ============================================================
-- Migration 019: Add goal column to sprints table
-- Date: 2026-07-30
-- Purpose: Добавить поле goal (цель спринта) в таблицу sprints
-- ============================================================

ALTER TABLE public.sprints
  ADD COLUMN IF NOT EXISTS goal text;