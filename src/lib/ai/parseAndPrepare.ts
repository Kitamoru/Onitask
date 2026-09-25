/**
 * F-04 · Общий parse-пайплайн (шаги 3–8 контракта §3.6) для двухфазного
 * создания задачи.
 *
 * Фаза 1 (draft): prepareTaskDraft() — только распознавание, НОЛЬ записей в БД.
 *   Возвращает ParseResponseV2 + strategy + showCorrectionSheet для превью.
 * Фаза 2 (commit): /api/ai/create-task с параметром `parsed` — сервер
 *   перечитывает settings/workers, перезапускает Gatekeeper и assignee-match
 *   на подтверждённых данных и делает INSERT.
 *
 * Семантика: задача рождается только по явному подтверждению пользователя.
 * «Отмена» в TWA — отсутствие мутации, а не компенсирующий DELETE.
 *
 * Based on: onitask_ai_.md §3.6 (F-04 Route), §3.5 (Gatekeeper)
 * Security: onitask_security_.md §1.1 (JSON mode + Zod)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/supabase';
import { buildParsePrompt } from './prompts';
import {
  parseF04Config,
  determineEnrichmentStrategy,
  type EnrichmentStrategy,
  type F04Config,
  type ParseResponseV2,
} from './types';
import {
  parseWithFallback,
  type ProviderUsed,
  type FallbackStep,
} from './parseWithFallback';
import { getOperationalContext, type OperationalContext } from './operationalContext';

type AppSupabase = SupabaseClient<Database>;

export interface PreparedDraft {
  parsed: ParseResponseV2;
  strategy: EnrichmentStrategy;
  /** null при two-phase (parse уже был сделан на этапе draft) */
  provider_used: ProviderUsed | null;
  chain: FallbackStep[];
  attempts_ms: number;
  showCorrectionSheet: boolean;
  /** Контекст commit-фазы: config для Gatekeeper, workers для matchAssignee */
  config: F04Config;
  workers: { id: string; display_name: string }[];
}

export type PrepareResult =
  | { ok: true; draft: PreparedDraft }
  | { ok: false; error: string; status: number };

export interface DraftContext {
  config: F04Config;
  /** Воркспейс-контекст для промпта (draft-фаза) */
  settings: {
    workspace_context: string | null;
    data_sharing_level: string;
  } | null;
  /**
   * Оперативный контекст workspace, посчитанный в SQL (F03-16, миграция 114/115).
   * Заменяет LLM-кэш `workspace_context_cache` — тот не был задеплоен и был
   * NULL во всех workspace. null = RPC не дал данных, блок в промпте опускается.
   */
  operationalContext: OperationalContext | null;
  workers: { id: string; display_name: string }[];
}

/**
 * Шаги 3–8: settings → cache → workers → prompt → parse → Gatekeeper →
 * showCorrection. Никогда не пишет в БД.
 */
export async function prepareTaskDraft(
  supabase: AppSupabase,
  workspaceId: string,
  input: string,
): Promise<PrepareResult> {
  const ctx = await loadDraftContext(supabase, workspaceId);
  if ('error' in ctx) {
    return { ok: false, error: ctx.error, status: ctx.status };
  }

  // 4. Build prompt
  const prompt = buildParsePrompt(
    input,
    {
      workspace_context: ctx.settings?.workspace_context ?? null,
      operational_context: ctx.operationalContext,
      data_sharing_level: ctx.settings?.data_sharing_level ?? 'standard',
    },
    ctx.workers ?? [],
  );

  // 5. Parse with fallback chain (F04-12): ND → Groq → deterministic
  const { parsed, provider_used, chain, attempts_ms } =
    await parseWithFallback(prompt);

  // 6. Gatekeeper → enrichment strategy
  const strategy: EnrichmentStrategy = determineEnrichmentStrategy(
    parsed,
    ctx.config,
  );

  // 13. Correction Sheet condition (same formula as commit phase)
  const showCorrectionSheet =
    parsed.clarity_score < ctx.config.correction_sheet_clarity_threshold ||
    parsed.confidence < 0.8;

  return {
    ok: true,
    draft: {
      parsed,
      strategy,
      provider_used,
      chain,
      attempts_ms,
      showCorrectionSheet,
      config: ctx.config,
      workers: ctx.workers,
    },
  };
}

/**
 * Читает settings + workers воркспейса (нужно и draft-фазе, и commit-фазе).
 * Возвращает либо контекст, либо готовую к ответу ошибку.
 */
export async function loadDraftContext(
  supabase: AppSupabase,
  workspaceId: string,
): Promise<DraftContext | { error: string; status: number }> {
  // maybeSingle() -> отсутствие строки даёт NULL → дефолты parseF04Config,
  // без hard-fail (см. комментарий в create-task route).
  const { data: settings, error: settingsError } = await supabase
    .from('workspace_settings')
    .select('f04_config, workspace_context, data_sharing_level')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (settingsError) {
    return { error: 'Не удалось загрузить настройки', status: 500 };
  }

  const config = parseF04Config(settings?.f04_config);
  const sharingLevel = settings?.data_sharing_level ?? 'standard';
  const operationalContext =
    sharingLevel === 'minimal' ? null : await getOperationalContext(supabase, workspaceId);

  const { data: workers, error: workersError } = await supabase
    .from('workers')
    .select('id, display_name')
    .eq('workspace_id', workspaceId);

  if (workersError) {
    return { error: 'Не удалось загрузить команду', status: 500 };
  }

  return {
    config,
    settings,
    operationalContext,
    workers: workers ?? [],
  };
}

/** Шаг 8: assignee matching display_name → worker ID. */
export function matchAssignee(
  workers: { id: string; display_name: string }[] | null,
  parsed: ParseResponseV2,
): string | null {
  if (!parsed.assignee) return null;
  const matched = (workers ?? []).find(
    (w) => w.display_name.toLowerCase() === parsed.assignee?.toLowerCase(),
  );
  return matched?.id ?? null;
}

/** Шаг 9: финализация title/description. */
export function finalizeTitles(parsed: ParseResponseV2): {
  finalTitle: string;
  finalDescription: string;
} {
  return {
    finalTitle: parsed.rewritten_title?.trim() || parsed.title,
    finalDescription: parsed.rewritten_description?.trim() || '',
  };
}