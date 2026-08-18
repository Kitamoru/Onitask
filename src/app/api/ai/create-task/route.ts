/**
 * F-04 AI — Create Task endpoint (F04-07).
 *
 * POST /api/ai/create-task
 * Body: { init_data, input }
 *
 * Полный F-04 Route Handler по контракту onitask_ai_.md §3.6:
 *   1. Auth (initData)
 *   2. Resolve workspace_id via workers.source_id = profileId
 *   3. Load workspace settings (f04_config, workspace_context, data_sharing_level)
 *   4. Load team workers
 *   5. Build parse prompt (prompts.ts)
 *   6. Call Groq llama-3.3-70b-versatile with JSON mode (groq.ts)
 *   7. Validate with Zod (types.ts) — fallback to safe defaults
 *   8. Run Gatekeeper → enrichment strategy (types.ts)
 *   9. Assignee matching: display_name → worker ID
 *   10. INSERT tasks со ВСЕМИ полями (raw_input, clarity_score, complexity,
 *       enrichment_strategy, cognitive_weight, tags, column, assignee)
 *   11. IF skip → INSERT task_enrichments (deterministic)
 *       IF !skip → INSERT enrichment_queue
 *   12. INSERT task_events (parse_rewrite)
 *   13. Return { task, parse, strategy, showCorrectionSheet }
 *
 * Based on: onitask_ai_.md §3.6, TASKS.md F04-07
 * Security: onitask_security_.md §1.1 (JSON mode + Zod), INV-05 (workspace_id)
 * A-1: Vercel Hot Path (< 2s), A-6: single model call
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { createServerClient } from '../../../../../lib/supabase';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
import { chatCompletion } from '../../../../lib/ai/neuralDeepHub';
import { buildParsePrompt } from '../../../../lib/ai/prompts';
import {
  validateParseResponse,
  parseF04Config,
  determineEnrichmentStrategy,
  type ParseResponseV2,
  type EnrichmentStrategy,
} from '../../../../lib/ai/types';
import type { Database } from '../../../../../types/supabase';
import { getWorkspaceContextCache } from '../../../../lib/ai/workspaceContextCache';

type TasksInsert = Database['public']['Tables']['tasks']['Insert'];

interface CreateTaskBody {
  init_data?: string;
  input?: string;
  service_token?: string;
  workspace_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateTaskBody;
    const { init_data, input, service_token, workspace_id: explicitWorkspaceId } = body;

    let auth = await authenticateRequest(init_data);

    // Server-to-server auth: bot calls this endpoint with service_token + explicit workspace_id
    if (!auth.authenticated && !init_data) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearer = authHeader.replace(/^Bearer\s+/i, '');
      if (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY) {
        auth = { authenticated: true };
      }
    }

    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    if (!input || !input.trim()) {
      return NextResponse.json({ error: 'Поле input обязателен' }, { status: 400 });
    }

    const supabase = createServerClient();
    const profileId = auth.profileId;

    // Resolve workspace_id: explicit from body > user's active worker
    let workspaceId = explicitWorkspaceId || null;
    if (!workspaceId && profileId) {
      const { data: userWorkers, error: userWorkersError } = await supabase
        .from('workers')
        .select('id, workspace_id')
        .eq('source_id', profileId)
        .eq('is_active', true)
        .limit(1);

      if (userWorkersError) {
        return NextResponse.json({ error: 'Не удалось определить рабочее пространство' }, { status: 500 });
      }

      workspaceId = userWorkers?.[0]?.workspace_id ?? null;
    }

    if (!workspaceId) {
      return NextResponse.json({ error: 'Рабочее пространство не найдено' }, { status: 404 });
    }

    // 3. Load workspace settings (f04_config, context, data_sharing_level)
    const { data: settings, error: settingsError } = await supabase
      .from('workspace_settings')
      .select('f04_config, workspace_context, data_sharing_level')
      .eq('workspace_id', workspaceId)
      .single();

    if (settingsError) {
      return NextResponse.json({ error: 'Не удалось загрузить настройки' }, { status: 500 });
    }

    const config = parseF04Config(settings?.f04_config);

    // 3a. Read workspace_context_cache via dedicated utility (F04-11)
    const cacheResult = await getWorkspaceContextCache(workspaceId);

    // 3b. Load team workers (id + display_name for assignee matching)
    const { data: workers, error: workersError } = await supabase
      .from('workers')
      .select('id, display_name')
      .eq('workspace_id', workspaceId);

    if (workersError) {
      return NextResponse.json({ error: 'Не удалось загрузить команду' }, { status: 500 });
    }

    // 4. Build prompt
    const prompt = buildParsePrompt(input, {
      workspace_context: settings?.workspace_context ?? null,
      workspace_context_cache: cacheResult?.workspace_context_cache ?? null,
      data_sharing_level: settings?.data_sharing_level ?? 'standard',
    }, workers ?? []);

    // 5. Call Neural Deep Hub (qwen3.6-35b-a3b-noreason) with JSON mode
    const raw = await chatCompletion({ prompt });

    // 5a. Log raw response for debugging parse failures
    console.log('[F-04] Raw NDH response:', raw?.slice(0, 500));

    // 6. Validate with Zod — log full error on failure
    let parsed: ParseResponseV2;
    try {
      parsed = validateParseResponse(JSON.parse(raw));
    } catch (err) {
      console.error('[F-04] Parse response validation failed:', err);
      console.error('[F-04] Raw response snippet:', raw?.slice(0, 200));
      parsed = validateParseResponse(null);
    }

    // 7. Gatekeeper → enrichment strategy
    const strategy: EnrichmentStrategy = determineEnrichmentStrategy(parsed, config);

    // 8. Assignee matching: display_name → worker ID (ai_.md §3.6)
    let assignedTo: string | null = null;
    if (parsed.assignee) {
      const matched = (workers ?? []).find(
        (w) => w.display_name.toLowerCase() === parsed.assignee?.toLowerCase(),
      );
      assignedTo = matched?.id ?? null;
    }

    // 9. Title/Description finalization (ai_.md §3.6)
    // При низком clarity rewritten_description может быть пустым (§3.4) — задача идёт
    // в Correction Sheet, сырой input НЕ должен попадать в описание как fallback.
    const finalTitle = parsed.rewritten_title?.trim() || parsed.title;
    const finalDescription = parsed.rewritten_description?.trim() || '';

    // 10. INSERT tasks со ВСЕМИ полями (raw_input, clarity, complexity, strategy, tags, column)
    const insertPayload: TasksInsert = {
      workspace_id: workspaceId,
      title: finalTitle,
      description: finalDescription,
      column: parsed.column ?? 'backlog',
      is_inbox: !parsed.column,
      priority: parsed.priority ?? 'medium',
      assigned_to: assignedTo,
      deadline: parsed.deadline,
      tags: parsed.tags ?? [],
      raw_input: input,
      clarity_score: parsed.clarity_score,
      complexity: parsed.complexity,
      enrichment_strategy: strategy,
      cognitive_weight: strategy === 'skip' ? 0 : 1,
      source: service_token ? 'telegram_bot' : 'manual',
    };

    const { data: task, error: insertError } = await supabase
      .from('tasks')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const taskId = (task as { id: string }).id;

    // 11. IF skip → INSERT task_enrichments (deterministic) / IF !skip → INSERT enrichment_queue
    if (strategy === 'skip') {
      await supabase.from('task_enrichments').insert({
        task_id: taskId,
        workspace_id: workspaceId,
        cognitive_weight: null,
        story_points: null,
        enrichment_status: 'done',
        model_used: 'deterministic',
      });
    } else {
      await supabase.from('enrichment_queue').insert({
        workspace_id: workspaceId,
        type: 'card',
        payload: { task_id: taskId, mode: strategy },
        status: 'pending',
        scheduled_at: new Date().toISOString(),
      });
    }

    // 12. INSERT task_events (parse_rewrite)
    await supabase.from('task_events').insert({
      workspace_id: workspaceId,
      task_id: taskId,
      event_type: 'parse_rewrite',
      payload: {
      raw_input: input,
      metadata: service_token ? { source: 'telegram_bot' } : undefined,
        rewritten_title: parsed.rewritten_title,
        rewritten_description: parsed.rewritten_description,
        clarity_score: parsed.clarity_score,
        complexity: parsed.complexity,
        enrichment_strategy: strategy,
        used_rewritten: !!parsed.rewritten_title?.trim(),
      },
    });

    // 13. Correction Sheet condition (ai_.md §3.7)
    const showCorrectionSheet =
      parsed.clarity_score < config.correction_sheet_clarity_threshold ||
      parsed.confidence < 0.80;

    return NextResponse.json({ task, parse: parsed, strategy, showCorrectionSheet });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка AI-создания задачи' },
      { status: 500 },
    );
  }
}