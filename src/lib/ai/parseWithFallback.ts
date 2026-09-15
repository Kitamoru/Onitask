/**
 * F04-12 · Parse with fallback chain (Hot Path, Vercel).
 *
 * Цепочка попыток при парсинге задачи (F-04 create-task):
 *   1. NeuralDeep (primary) — qwen3.8-27b-noreason
 *   2. Groq Qwen (fallback) — qwen/qwen3.8-27b, reasoning_effort: none
 *   3. Deterministic SAFE_FALLBACK_PARSE (final safety net, не LLM)
 *
 * Если обе LLM-попытки завершились ошибкой — возвращаем детерминированный
 * безопасный fallback без бросания ошибки. Route продолжает работать,
 * пользователь не видит сбоя.
 *
 * Если LLM вернула ответ, но Zod-валидация не прошла —
 * validateParseResponse() вернёт SAFE_FALLBACK_PARSE автоматически.
 *
 * Audit: результат включает provider_used и chain метрики для task_events.payload.
 *
 * Based on: onitask_ai_.md §3.4 (Parse), §3.6 (F-04 Route)
 *           onitask_security_.md §1.1 (JSON mode + Zod)
 *           systemPatterns.md A-06 (Hot Path fallback exception)
 */

import { chatCompletion as chatNeuralDeep } from './neuralDeepHub';
import { chatCompletionQwen } from './groq';
import {
  SAFE_FALLBACK_PARSE,
  type ParseResponseV2,
  validateParseResponse,
} from './types';

export type ProviderUsed = 'neuraldeep' | 'groq' | 'deterministic-fallback';
export type FallbackStepStatus = 'success' | 'error';

export interface FallbackStep {
  provider: ProviderUsed;
  status: FallbackStepStatus;
  error?: string;
}

export interface ParseWithFallbackResult {
  /** Провайдер, чей ответ прошел валидацию */
  provider_used: ProviderUsed;
  /** Парсинг после Zod-валидации (никогда unsafe raw) */
  parsed: ParseResponseV2;
  /** Цепочка шагов для аудита */
  chain: FallbackStep[];
  /** Общее время попыток (мс) */
  attempts_ms: number;
}

const CHAIN_MAX_ATTEMPTS = 2; // ND + Groq (без кругового ретрая, как договорились)

/**
 * Выполняет парсинг с резервной линией.
 * При успехе любой из LLM — валидирует через Zod.
 * При падении обеих LLM — возвращает SAFE_FALLBACK_PARSE.
 */
export async function parseWithFallback(
  prompt: string,
  opts?: { temperature?: number; max_tokens?: number },
): Promise<ParseWithFallbackResult> {
  const steps: FallbackStep[] = [];
  const start = performance.now();
  let lastErr: unknown = undefined;

  // 1. NeuralDeep — primary
  steps.push({ provider: 'neuraldeep', status: 'error' });
  try {
    const raw = await chatNeuralDeep({ prompt, ...opts });
    const parsed = validateParseResponse(JSON.parse(raw));
    // Если parsed === SAFE_FALLBACK_PARSE → Zod не прошла, пробуем Groq
    // (парсер не обязательно упал, но результат невалиден для нас)
    const usedDeterministic = isDeterministicFallback(parsed);
    if (usedDeterministic) {
      steps[0].status = 'error';
      steps[0].error = 'Zod validation returned safe fallback';
      lastErr = new Error('ND response failed Zod validation');
    } else {
      steps[0].status = 'success';
      return {
        provider_used: 'neuraldeep',
        parsed,
        chain: steps,
        attempts_ms: Math.round(performance.now() - start),
      };
    }
  } catch (err) {
    steps[0].error = err instanceof Error ? err.message : String(err);
    lastErr = err;
  }

  // 2. Groq Qwen — fallback
  steps.push({ provider: 'groq', status: 'error' });
  try {
    const raw = await chatCompletionQwen({ prompt, ...opts });
    const parsed = validateParseResponse(JSON.parse(raw));
    const usedDeterministic = isDeterministicFallback(parsed);
    if (usedDeterministic) {
      steps[1].status = 'error';
      steps[1].error = 'Zod validation returned safe fallback';
      lastErr = new Error('Groq response failed Zod validation');
    } else {
      steps[1].status = 'success';
      return {
        provider_used: 'groq',
        parsed,
        chain: steps,
        attempts_ms: Math.round(performance.now() - start),
      };
    }
  } catch (err) {
    steps[1].error = err instanceof Error ? err.message : String(err);
    lastErr = err;
  }

  // 3. Обе LLM не справились — детерминированный fallback (не бросаем)
  console.warn(
    '[F-04][F04-12] Both NeuralDeep and Groq failed. Using SAFE_FALLBACK_PARSE.',
    lastErr,
  );
  steps.push({ provider: 'deterministic-fallback', status: 'success' });
  return {
    provider_used: 'deterministic-fallback',
    parsed: SAFE_FALLBACK_PARSE,
    chain: steps,
    attempts_ms: Math.round(performance.now() - start),
  };
}

/**
 * Проверяет, что парсинг вернулся в детерминированный fallback.
 * SAFE_FALLBACK_PARSE распознаётся по характерным признакам:
 * - title === ''
 * - confidence === 0
 * - clarity_score === 0
 */
function isDeterministicFallback(parsed: ParseResponseV2): boolean {
  return (
    parsed.title === '' &&
    parsed.confidence === 0 &&
    parsed.clarity_score === 0 &&
    parsed.rewritten_title === '' &&
    parsed.rewritten_description === ''
  );
}
