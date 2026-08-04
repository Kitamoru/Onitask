/**
 * F-04 AI types, Zod schemas, and Gatekeeper.
 *
 * Based on: onitask_ai_.md §3.3 (ParseResponseV2), §3.4 (F04Config), §3.5 (Gatekeeper)
 * Security: onitask_security_.md §1.1 (JSON mode + Zod validation)
 */

import { z } from 'zod';

// ─── ParseResponseV2 (ai_.md §3.3) ────────────────────────────────────────────

export interface ParseResponseV2 {
  title: string;
  column: 'backlog' | 'in_progress' | 'review';
  priority: 'high' | 'medium' | 'low' | null;
  assignee: string | null;
  deadline: string | null;
  tags: string[];
  confidence: number;
  rewritten_title: string;
  rewritten_description: string;
  clarity_score: number;
  complexity: 1 | 2 | 3;
}

// ─── Zod Schema for LLM output validation (security §1.1) ─────────────────────
// Second line of defense after JSON mode — fallback to safe defaults on mismatch.

export const parseResponseSchema = z.object({
  title: z.string().min(1).max(500),
  column: z.enum(['backlog', 'in_progress', 'review']),
  priority: z.enum(['high', 'medium', 'low']).nullable(),
  assignee: z.string().nullable(),
  deadline: z.string().nullable(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  rewritten_title: z.string(),
  rewritten_description: z.string(),
  clarity_score: z.number().min(0).max(1),
  complexity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

// ─── F04Config (ai_.md §3.4) ───────────────────────────────────────────────────

export interface F04Config {
  skip_min_clarity: number;
  skip_max_complexity: number;
  correction_sheet_clarity_threshold: number;
  low_clarity_tag_threshold: number;
}

/** Default config from DB workspace_settings.f04_config */
export const DEFAULT_F04_CONFIG: F04Config = {
  skip_min_clarity: 0.85,
  skip_max_complexity: 1,
  correction_sheet_clarity_threshold: 0.70,
  low_clarity_tag_threshold: 0.55,
};

/**
 * Parse f04_config from workspace_settings jsonb.
 * Applies clamping to safe ranges per ai_.md §3.4.
 */
export function parseF04Config(raw: unknown): F04Config {
  const cfg = (raw ?? {}) as Partial<F04Config>;
  return {
    skip_min_clarity: Math.min(1, Math.max(0, cfg.skip_min_clarity ?? DEFAULT_F04_CONFIG.skip_min_clarity)),
    skip_max_complexity: [1, 2, 3].includes(cfg.skip_max_complexity ?? 1)
      ? (cfg.skip_max_complexity as 1 | 2 | 3)
      : 1,
    correction_sheet_clarity_threshold: Math.min(1, Math.max(0, cfg.correction_sheet_clarity_threshold ?? DEFAULT_F04_CONFIG.correction_sheet_clarity_threshold)),
    low_clarity_tag_threshold: Math.min(1, Math.max(0, cfg.low_clarity_tag_threshold ?? DEFAULT_F04_CONFIG.low_clarity_tag_threshold)),
  };
}

// ─── Gatekeeper (ai_.md §3.5) ──────────────────────────────────────────────────

export type EnrichmentStrategy = 'skip' | 'light' | 'standard';

/**
 * Deterministic Gatekeeper — decides enrichment strategy based on parse result.
 *
 * - skip: simple + clear → no LLM enrichment, deterministic task_enrichments
 * - light: moderate → partial enrichment (cognitive_weight + tags only)
 * - standard: complex → full enrichment pipeline
 */
export function determineEnrichmentStrategy(
  parse: Pick<ParseResponseV2, 'complexity' | 'clarity_score'>,
  config: F04Config,
): EnrichmentStrategy {
  if (parse.complexity <= config.skip_max_complexity && parse.clarity_score >= config.skip_min_clarity) {
    return 'skip';
  }
  if (parse.complexity >= 2) {
    return 'standard';
  }
  return 'light';
}

// ─── Transcribe Response ───────────────────────────────────────────────────────

export interface TranscribeResponse {
  text: string;
}

// ─── Safe fallback for Zod validation failure ──────────────────────────────────

export const SAFE_FALLBACK_PARSE: ParseResponseV2 = {
  title: '',
  column: 'backlog',
  priority: null,
  assignee: null,
  deadline: null,
  tags: [],
  confidence: 0,
  rewritten_title: '',
  rewritten_description: '',
  clarity_score: 0,
  complexity: 1,
};

/**
 * Validate LLM output with Zod. On failure — return safe fallback.
 * Never pass raw LLM output to the client without validation (security §1.1).
 */
export function validateParseResponse(raw: unknown): ParseResponseV2 {
  const result = parseResponseSchema.safeParse(raw);
  if (!result.success) {
    console.error('[F-04] Parse response validation failed:', result.error.issues);
    return SAFE_FALLBACK_PARSE;
  }
  return result.data;
}