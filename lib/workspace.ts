/**
 * Workspace utilities — generation and validation helpers.
 * 
 * Master Spec §8: task_prefix generation from slug.
 * Version: 0.13.5 (2026-07-15)
 */

// ═══════════════════════════════════════════════════════
// Task Prefix Generation (Master §8)
// ═══════════════════════════════════════════════════════

export interface PrefixResult {
  /** Generated prefix (2-6 uppercase Latin letters) */
  prefix: string;
  /** True if user needs to manually specify a valid prefix */
  needsManualReview: boolean;
}

/**
 * Generates a task_prefix from a workspace slug.
 * 
 * Rules (Architecture Master §8):
 * - Strip non-Latin characters: replace [^a-zA-Z\-_\s] with ''
 * - Split by hyphens/underscores/spaces → take first letter of each word
 * - Join and uppercase → slice to max 6 characters
 * - If single word → uppercase the whole word, slice to 6
 * - Validate against /^[A-Z]{2,6}$/
 * - Fallback: 'WS' + needsManualReview = true
 * 
 * Examples:
 *   'alpha'           → 'ALPHA'
 *   'my-project'      → 'MP'
 *   'design system'   → 'DS'
 *   'альфа'           → 'WS' (needsManualReview)
 *   'superlongword'   → 'SUPERL'
 * 
 * @param slug - The workspace slug (URL-safe identifier)
 * @returns {prefix, needsManualReview}
 */
export function generateTaskPrefix(slug: string): PrefixResult {
  const latinOnly = slug.replace(/[^a-zA-Z\-_\s]/g, '').trim();
  if (!latinOnly) return { prefix: 'WS', needsManualReview: true };

  const words = latinOnly.split(/[\-_\s]+/).filter(Boolean);
  let prefix: string;

  if (words.length === 1) {
    prefix = words[0].toUpperCase().slice(0, 6);
  } else {
    prefix = words.map(w => (w[0] ?? '').toUpperCase()).join('').slice(0, 6);
  }

  const isValid = /^[A-Z]{2,6}$/.test(prefix);
  return { prefix: isValid ? prefix : 'WS', needsManualReview: !isValid };
}

// ═══════════════════════════════════════════════════════
// Slug Validation
// ═══════════════════════════════════════════════════════

/**
 * Validates a workspace slug.
 * Must be lowercase alphanumeric + hyphens/underscores, 3-50 chars.
 */
export function validateSlug(slug: string): { valid: boolean; error?: string } {
  if (!slug || slug.length === 0) {
    return { valid: false, error: 'Slug is required' };
  }
  if (slug.length < 3) {
    return { valid: false, error: 'Slug must be at least 3 characters' };
  }
  if (slug.length > 50) {
    return { valid: false, error: 'Slug must be at most 50 characters' };
  }
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return { valid: false, error: 'Slug must contain only lowercase letters, numbers, hyphens and underscores' };
  }
  return { valid: true };
}

/**
 * Sanitizes a name for workspace creation.
 * Max 100 characters, trimmed.
 */
export function sanitizeName(name: string): { sanitized: string; valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { sanitized: '', valid: false, error: 'Name is required' };
  }
  if (trimmed.length > 100) {
    return { sanitized: trimmed.slice(0, 100), valid: false, error: 'Name must be at most 100 characters' };
  }
  return { sanitized: trimmed, valid: true };
}