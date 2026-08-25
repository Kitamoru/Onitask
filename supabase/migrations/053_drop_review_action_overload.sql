-- Migration 053: Fix 42725 "function is not unique" on review_action
-- Root cause: migration 051 added a 5-arg overload (p_reason DEFAULT NULL)
-- alongside the original 4-arg signature. PostgREST resolves RPCs by named
-- arguments, so any call with the 4 base args matched BOTH candidates
-- -> 42725 "could not choose best candidate" -> bot approve/fix always failed
-- with generic "Не удалось выполнить действие".
--
-- Fix: keep the single canonical 5-arg signature (049 logic + reason handling).
-- Existing 4-arg callers resolve to it unambiguously via DEFAULT NULL.
-- Rule: PostgREST-exposed RPCs must never be overloaded; evolve the single
-- signature via CREATE OR REPLACE + explicit DROP of prior versions.
-- (Applied to prod via Supabase MCP; this file mirrors remote history.)

DROP FUNCTION IF EXISTS public.review_action(uuid, text, integer, uuid);
