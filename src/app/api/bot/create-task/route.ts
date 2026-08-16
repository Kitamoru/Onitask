/**
 * POST /api/bot/create-task — Create task from Telegram Bot with full F-04 AI pipeline.
 *
 * This endpoint is called by the bot webhook when a user sends text/voice after /task.
 * It uses the SAME F-04 parse + enrichment logic as TWA's /api/ai/create-task,
 * but authenticates via telegram_user_id → profile → worker instead of init_data.
 *
 * Body: { telegram_user_id, workspace_id, text }
 * Returns: { task, parse, strategy, showCorrectionSheet }
 *
 * Security: Service token verification (BOT_API_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chatCompletion } from '../../../../lib/ai/groq';
import { buildParsePrompt } from '../../../../lib/ai/prompts';
import {
  validateParseResponse,
  parseF04Config,
  determineEnrichmentStrategy,
  type ParseResponseV2,
  type EnrichmentStrategy,
} from '../../../../lib/ai/types';
import { getWorkspaceContextCache } from '../../../../lib/ai/workspaceContextCache';
import { resolveProfileId } from '../../../../lib/bot/workspaceResolver';

const BOT_API_SECRET = process.env.TELEGRAM_BOT_SECRET;

export async function POST(req: NextRequest) {
  // 1. Verify service token
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${BOT_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { telegram_user_id, workspace_id, text } = body as {
      telegram_user_id?: number;
      workspace_id?: string;
      text?: string;
    };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Поле text обязательно' }, { status: 400 });
    }
    if (!workspace_id) {
      return NextResponse.json({ error: 'Поле workspace_id обязательно' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 2. Resolve profile from telegram_user_id
    let profileId: string | null = null;
    if (telegram_user_id) {
      profileId = await resolveProfileId(telegram_user_id);
    }

    // 3. Resolve worker_id for created_by
    let createdBy: string | null = null;
    if (profileId) {
      const { data: worker } = await supabase
        .from('workers')
        .select('id')
        .eq('source_id', profileId)
        .eq('workspace_id', workspace_id)
        .eq('is_active', true)
        .maybeSingle();
      createdBy = worker?.id ?? null;
    }

    // 4. Load workspace settings
    const { data: settings, error: settingsError } = await supabase
      .from('workspace_settings')
      .select('f04_config, workspace_context, data_sharing_level')
      .eq('workspace_id', workspace_id)
      .single();

    if (settingsError) {
      return NextResponse.json({ error: 'Не удалось загрузить настройки' }, { status: 500 });
    }

    const config = parseF04Config(settings?.f04_config);

    // 5. Load workspace context cache
    const cacheResult = await getWorkspaceContextCache(workspace_id);

    // 6. Load team workers for assignee matching
    const { data: workers, error: workersError } = await supabase
      .from('workers')
      .select('id, display_name')
      .eq('workspace_id', workspace_id);

    if (workersError) {
      return NextResponse.json({ error: 'Не удалось загрузить команду' }, { status: 500 });
    }

    // 7. Build F-04 parse prompt
    const prompt = buildParsePrompt(text, {
      workspace_context: settings?.workspace_context ?? null,
      workspace_context_cache: cacheResult?.workspace_context_cache ?? null,
      data_sharing_level: settings?.data_sharing_level ?? 'standard',
    }, workers ?? []);

    // 8. Call Groq with JSON mode
    const raw = await chatCompletion({ prompt });

    // 9. Validate with Zod
    let parsed: ParseResponseV2;
    try {
      parsed = validateParseResponse(JSON.parse(raw));
    } catch {
      parsed = validateParseResponse(null);
    }

    // 10. Gatekeeper → enrichment strategy
    const strategy: EnrichmentStrategy = determineEnrichmentStrategy(parsed, config);

    // 11. Assignee matching: display_name → worker ID
    let assignedTo: string | null = null;
    if (parsed.assignee) {
      const matched = (workers ?? []).find(
        (w) => w.display_name.toLowerCase() === parsed.assignee?.toLowerCase(),
      );
      assignedTo = matched?.id ?? null;
    }

    // 12. Title/Description finalization
    const finalTitle = parsed.rewritten_title?.trim() || parsed.title;
    const finalDescription = parsed.rewritten_description?.trim() || '';

    // 13. INSERT tasks со ВСЕМИ полями
    const { data: task, error: insertError } = await supabase
      .from('tasks')
      .insert({
        workspace_id: workspace_id,
        title: finalTitle,
        description: finalDescription,
        column: parsed.column ?? 'backlog',
        is_inbox: !parsed.column,
        priority: parsed.priority ?? 'medium',
        assigned_to: assignedTo,
        deadline: parsed.deadline,
        tags: parsed.tags ?? [],
        raw_input: text,
        clarity_score: parsed.clarity_score,
        complexity: parsed.complexity,
        enrichment_strategy: strategy,
        cognitive_weight: strategy === 'skip' ? 0 : 1,
        source: 'bot',
        created_by: createdBy,
      })
      .select('id, title, column, priority, version')
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const taskId = (task as { id: string }).id;

    // 14. IF skip → INSERT task_enrichments / IF !skip → INSERT enrichment_queue
    if (strategy === 'skip') {
      await supabase.from('task_enrichments').insert({
        task_id: taskId,
        workspace_id: workspace_id,
        cognitive_weight: null,
        story_points: null,
        enrichment_status: 'done',
        model_used: 'deterministic',
      });
    } else {
      await supabase.from('enrichment_queue').insert({
        workspace_id: workspace_id,
        type: 'card',
        payload: { task_id: taskId, mode: strategy },
        status: 'pending',
        scheduled_at: new Date().toISOString(),
      });
    }

    // 15. INSERT task_events (parse_rewrite)
    await supabase.from('task_events').insert({
      workspace_id: workspace_id,
      task_id: taskId,
      event_type: 'parse_rewrite',
      payload: {
        raw_input: text,
        rewritten_title: parsed.rewritten_title,
        rewritten_description: parsed.rewritten_description,
        clarity_score: parsed.clarity_score,
        complexity: parsed.complexity,
        enrichment_strategy: strategy,
        used_rewritten: !!parsed.rewritten_title?.trim(),
      },
    });

    // 16. Correction Sheet condition
    const showCorrectionSheet =
      parsed.clarity_score < config.correction_sheet_clarity_threshold ||
      parsed.confidence < 0.80;

    return NextResponse.json({
      task,
      parse: parsed,
      strategy,
      showCorrectionSheet,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка создания задачи через бота' },
      { status: 500 },
    );
  }
}