/**
 * workspaceContextCache.ts — утилита для чтения оперативного контекста воркспейса.
 *
 * workspace_context_cache хранится в workspace_settings (text, ≤500 символов)
 * и формируется Edge Function rebuild-workspace-context.
 *
 * INV-14: система никогда не пишет в это поле напрямую из Route Handler'ов.
 * INV-05: все AI-outputs содержат workspace_id → кеш привязан к workspace_id.
 */

import { createServerClient } from '../../../lib/supabase';

export interface WorkspaceContextCacheResult {
  /** JSON-строка с оперативным состоянием (спринт, загрузка, блокеры и т.д.) */
  workspace_context_cache: string | null;
  /** Флаг «кеш устарел» — ставится триггерами при изменениях */
  context_stale: boolean;
}

/**
 * Читает workspace_context_cache из workspace_settings.
 * Возвращает null, если кеш отсутствует или произошла ошибка.
 */
export async function getWorkspaceContextCache(
  workspaceId: string,
): Promise<WorkspaceContextCacheResult | null> {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('workspace_settings')
      .select('workspace_context_cache, context_stale')
      .eq('workspace_id', workspaceId)
      .single();

    if (error) {
      console.error('[getWorkspaceContextCache] DB error:', error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      workspace_context_cache: data.workspace_context_cache ?? null,
      context_stale: data.context_stale ?? false,
    };
  } catch (err) {
    console.error('[getWorkspaceContextCache] Unexpected error:', err);
    return null;
  }
}