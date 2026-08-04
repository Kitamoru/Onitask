'use server';

/**
 * F-04 AI — Parse Task endpoint (F04-03 + F04-04 + F04-07).
 *
 * POST /api/ai/parse-task
 * Body: { init_data, input }
 *
 * Flow:
 *   1. Auth (initData)
 *   2. Load workspace settings (f04_config, workspace_context, data_sharing_level)
 *   3. Load team workers
 *   4. Build parse prompt (prompts.ts)
 *   5. Call Groq llama-3.3-70b-versatile with JSON mode (groq.ts)
 *   6. Validate with Zod (types.ts) — fallback to safe defaults
 *   7. Run Gatekeeper → enrichment strategy (types.ts)
 *   8. Return { parse, strategy }
 *
 * Based on: onitask_ai_.md §3.3–§3.5
 * Security: onitask_security_.md §1.1 (JSON mode + Zod)
 * A-1: Vercel Hot Path (< 2s), A-6: single model call
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { createServerClient } from '../../../../../lib/supabase';
import { chatCompletion } from '../../../../lib/ai/groq';
import { buildParsePrompt } from '../../../../lib/ai/prompts';
import {
  validateParseResponse,
  parseF04Config,
  determineEnrichmentStrategy,
  type ParseResponseV2,
  type EnrichmentStrategy,
} from '../../../../lib/ai/types';

interface ParseTaskBody {
  init_data?: string;
  input?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ParseTaskBody;
    const { init_data, input } = body;

    const auth = await authenticateRequest(init_data);
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    if (!input || !input.trim()) {
      return NextResponse.json({ error: 'Поле input обязательно' }, { status: 400 });
    }

    const supabase = createServerClient();
    const profileId = auth.profileId!;

    // 1. Resolve workspace_id via user's active worker (source_id = profileId)
    const { data: userWorkers, error: userWorkersError } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profileId)
      .eq('is_active', true)
      .limit(1);

    if (userWorkersError) {
      return NextResponse.json({ error: 'Не удалось определить рабочее пространство' }, { status: 500 });
    }

    const workspaceId = userWorkers?.[0]?.workspace_id;
    if (!workspaceId) {
      return NextResponse.json({ error: 'Рабочее пространство не найдено' }, { status: 404 });
    }

    // 2. Load workspace settings (f04_config, context, data_sharing_level)
    const { data: settings, error: settingsError } = await supabase
      .from('workspace_settings')
      .select('f04_config, workspace_context, workspace_context_cache, data_sharing_level')
      .eq('workspace_id', workspaceId)
      .single();

    if (settingsError) {
      return NextResponse.json({ error: 'Не удалось загрузить настройки' }, { status: 500 });
    }

    const config = parseF04Config(settings?.f04_config);

    // 3. Load team workers
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
      workspace_context_cache: settings?.workspace_context_cache ?? null,
      data_sharing_level: settings?.data_sharing_level ?? 'standard',
    }, workers ?? []);

    // 5. Call Groq with JSON mode
    const raw = await chatCompletion({ prompt });

    // 6. Validate with Zod
    let parsed: ParseResponseV2;
    try {
      parsed = validateParseResponse(JSON.parse(raw));
    } catch {
      parsed = validateParseResponse(null);
    }

    // 7. Gatekeeper → enrichment strategy
    const strategy: EnrichmentStrategy = determineEnrichmentStrategy(parsed, config);

    return NextResponse.json({ parse: parsed, strategy });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка AI-парсинга' },
      { status: 500 },
    );
  }
}