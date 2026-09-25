// src/lib/ai/operationalContext.ts — оперативный контекст workspace (F03-16, миграция 114/115)
//
// ЗАМЕНЯЕТ: `workspaceContextCache.ts` — чтение поля `workspace_context_cache`,
// которое наполнял Edge Function `rebuild-workspace-context` через LLM.
//
// Почему заменено, а не починено:
//   - функция ни разу не была задеплоена, кэш = NULL во всех workspace;
//   - LLM использовался как JSON-компрессор для данных, уже лежащих в БД —
//     платная недетерминированная потеря информации;
//   - те же величины (`buildFlowMetrics`) уже считаются детерминированно на
//     каждом запросе для /api/flow/metrics.
//
// Теперь контекст считается в SQL функцией `get_workspace_operational_context`
// по требованию: без кэша, без cron, без флага `context_stale`.
//
// Порог перегрузки — шкала F-01 (>= 3), согласованно с buildFlowMetrics и UI.
// ВНИМАНИЕ: view `overloaded_workers` использует другой порог
// (flow_config.overload_threshold, default 6) — расхождение не унифицировано.

import type { SupabaseClient } from '@supabase/supabase-js';
// Тот же Database, что и у вызывающего кода (src/lib/ai/parseAndPrepare.ts):
// types/supabase.ts — сгенерированный. types/database.ts — устаревший,
// его типы не совпадают (profiles.updated_at), поэтому здесь не подходит.
import type { Database } from '../../../types/supabase';

type AppSupabase = SupabaseClient<Database>;

/**
 * Оперативное состояние workspace, попадающее в промпт F-03/F-04.
 *
 * INV-05: все AI-outputs привязаны к workspace_id.
 * Содержит display_name участников → при data_sharing_level='minimal'
 * вызывающий код обязан не передавать его провайдеру (INV-15).
 */
export interface OperationalContext {
  sprint: { name: string; goal: string | null; status: string } | null;
  /** Участники с когнитивной нагрузкой >= 3 (шкала F-01, 0–3) */
  overloaded_workers: string[];
  escalations: number;
  /** Фантомные блокировки: заблокировано только завершёнными */
  blockers: number;
  active_tasks: number;
}

/**
 * Читает оперативный контекст через RPC. Возвращает null, если данных нет
 * или RPC завершился ошибкой — вызывающий код опускает блок промпта.
 *
 * Ошибка не пробрасывается: обогащение/парсинг не должны падать из-за
 * справочного контекста (A-6 — UX не блокируется).
 */
export async function getOperationalContext(
  supabase: AppSupabase,
  workspaceId: string,
): Promise<OperationalContext | null> {
  try {
    const { data, error } = await supabase.rpc('get_workspace_operational_context', {
      p_workspace_id: workspaceId,
    });

    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      console.error('[getOperationalContext] RPC failed:', error?.message ?? error);
      return null;
    }

    // RPC объявлена как Returns: Json, поэтому сужаем до формы объекта.
    const ctx = data as Record<string, unknown>;
    const sprint = ctx.sprint;

    return {
      sprint:
        sprint && typeof sprint === 'object' && !Array.isArray(sprint)
          ? (sprint as OperationalContext['sprint'])
          : null,
      overloaded_workers: Array.isArray(ctx.overloaded_workers)
        ? (ctx.overloaded_workers as string[])
        : [],
      escalations: typeof ctx.escalations === 'number' ? ctx.escalations : 0,
      blockers: typeof ctx.blockers === 'number' ? ctx.blockers : 0,
      active_tasks: typeof ctx.active_tasks === 'number' ? ctx.active_tasks : 0,
    };
  } catch (err) {
    console.error('[getOperationalContext] Unexpected error:', err);
    return null;
  }
}

/**
 * true, если контекст не содержит ничего, о чём стоит сообщать модели
 * (пустой workspace). Позволяет не раздувать промпт пустым блоком.
 */
export function isOperationalContextEmpty(ctx: OperationalContext | null): boolean {
  if (!ctx) return true;
  return (
    !ctx.sprint &&
    ctx.overloaded_workers.length === 0 &&
    ctx.escalations === 0 &&
    ctx.blockers === 0
  );
}
