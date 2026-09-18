/**
 * F-04 AI — Create Task endpoint (F04-07).
 *
 * POST /api/ai/create-task
 * Body: { init_data, input, workspace_id?, source?, profile_id?, parsed? }
 *
 * Полный F-04 Route Handler по контракту onitask_ai_.md §3.6.
 * Два режима (two-phase creation, §4.1):
 *
 * 1) Commit-фаза TWA: `parsed` присутствует — черновик уже распознан и
 *    подтверждён пользователем в /api/ai/parse-task. Здесь БЕЗ model call:
 *    Zod-валидация → Gatekeeper → assignee-match → INSERT.
 * 2) Legacy inline (bot / MCP / старые клиенты): `parsed` отсутствует —
 *    parse + INSERT за один вызов, как раньше.
 *
 * 1. Auth (initData или service-role Bearer)
 * 2. Resolve workspace_id via workers.source_id = profileId
 * 3. Load workspace settings (f04_config, workspace_context, data_sharing_level)
 * 4. Load team workers
 * 5. Build parse prompt (prompts.ts) — только legacy-режим
 * 6. Call Groq / NDH with JSON mode — только legacy-режим
 * 7. Validate with Zod (types.ts) — fallback to safe defaults
 * 8. Run Gatekeeper → enrichment strategy (types.ts)
 * 9. Assignee matching: display_name → worker ID
 * 10. INSERT tasks со ВСЕМИ полями (raw_input, clarity_score, complexity,
 *     enrichment_strategy, cognitive_weight, tags, column, assignee, source, created_by)
 * 11. IF skip → INSERT task_enrichments (deterministic)
 *     IF !skip → INSERT enrichment_queue
 * 12. INSERT task_events (parse_rewrite)
 * 13. Return { task, parse, strategy, showCorrectionSheet }
 *
 * Based on: onitask_ai_.md §3.6, TASKS.md F04-07
 * Security: onitask_security_.md §1.1 (JSON mode + Zod), INV-05 (workspace_id)
 * A-1: Vercel Hot Path (< 2s), A-6: single model call (legacy-режим)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  getDefaultWorkspaceId,
  getUserWorkspaceIds,
} from '../../../../../lib/api-auth';
import { createServerClient } from '../../../../../lib/supabase';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

import {
  determineEnrichmentStrategy,
  parseResponseSchema,
  type EnrichmentStrategy,
  type ParseResponseV2,
  type F04Config,
} from '../../../../lib/ai/types';
import type {
  ProviderUsed,
  FallbackStep,
} from '../../../../lib/ai/parseWithFallback';
import type { Database } from '../../../../../types/supabase';
import {
  prepareTaskDraft,
  loadDraftContext,
  matchAssignee,
  finalizeTitles,
} from '../../../../lib/ai/parseAndPrepare';

type TasksInsert = Database['public']['Tables']['tasks']['Insert'];

interface CreateTaskBody {
  init_data?: string;
  input?: string;
  service_token?: string;
  workspace_id?: string;
  /** Explicit source from caller: 'bot' | 'manual' | ... */
  source?: string;
  /** Profile UUID of the acting user (required for bot/service calls to set created_by) */
  profile_id?: string;
  /**
   * Two-phase creation: подтверждённый пользователем черновик (TWA preview).
   * Присутствует → commit-фаза без model call. Отсутствует → legacy inline.
   */
  parsed?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateTaskBody;
    const {
      init_data,
      input,
      service_token,
      workspace_id: explicitWorkspaceId,
      source: bodySource,
      profile_id: bodyProfileId,
    } = body;

    let auth = await authenticateRequest(init_data);

    // Server-to-server auth: bot calls this endpoint with service-role Bearer
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

    // Effective profile: from initData auth OR explicit body (bot path)
    const profileId = auth.profileId || bodyProfileId || null;

    // Resolve workspace_id: explicit from body > default from profile membership.
    // Explicit ID is verified against membership to keep tenant isolation (INV-05):
    // otherwise any authenticated caller who knows a foreign workspace UUID could
    // insert a task into it (service-role client bypasses RLS).
    const userWorkspaceIds = profileId ? await getUserWorkspaceIds(profileId) : [];
    let workspaceId = explicitWorkspaceId
      ? (userWorkspaceIds.includes(explicitWorkspaceId)
          ? explicitWorkspaceId
          : null)
      : profileId
        ? ((await getDefaultWorkspaceId(profileId)) ?? null)
        : null;

    if (!workspaceId) {
      // Explicit workspace requested but profile is not a member → 403.
      if (explicitWorkspaceId) {
        return NextResponse.json(
          { error: 'Доступ запрещён: вы не являетесь участником этого workspace' },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: 'Рабочее пространство не найдено' }, { status: 404 });
    }

    // ── Parse phase (шаги 3–9) ──
    // Two-phase creation: `parsed` присутствует = фаза подтверждения (TWA
    // preview). Черновик уже распознан в /api/ai/parse-task; здесь БЕЗ
    // model call: Zod → Gatekeeper → assignee-match на подтверждённых данных.
    // Без `parsed` (bot / MCP / legacy) — полный inline-путь: parse + insert
    // за один вызов, поведение не менялось.
    const isConfirmedCommit = body.parsed !== undefined && body.parsed !== null;

    let parsed: ParseResponseV2;
    let strategy: EnrichmentStrategy;
    let providerUsed: ProviderUsed | null;
    let chain: FallbackStep[];
    let attemptsMs: number;
    let config: F04Config;
    let workers: { id: string; display_name: string }[];

    if (isConfirmedCommit) {
      const ctx = await loadDraftContext(supabase, workspaceId);
      if ('error' in ctx) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status });
      }

      // Сервер не доверяет клиенту: подтверждённый parse проходит Zod заново.
      const zod = parseResponseSchema.safeParse(body.parsed);
      if (!zod.success) {
        return NextResponse.json(
          { error: 'Некорректные данные черновика задачи' },
          { status: 400 },
        );
      }
      parsed = zod.data;
      config = ctx.config;
      workers = ctx.workers;
      strategy = determineEnrichmentStrategy(parsed, config);
      // Метрики provider недоступны (parse был в draft-фазе) —
      // аудит помечается parse_phase='user_confirmed_draft' в task_events.
      providerUsed = null;
      chain = [];
      attemptsMs = 0;
    } else {
      const result = await prepareTaskDraft(supabase, workspaceId, input.trim());
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      parsed = result.draft.parsed;
      strategy = result.draft.strategy;
      providerUsed = result.draft.provider_used;
      chain = result.draft.chain;
      attemptsMs = result.draft.attempts_ms;
      config = result.draft.config;
      workers = result.draft.workers;

      console.log(
        `[F-04][F04-12] provider_used: ${providerUsed}, attempts_ms: ${attemptsMs}, chain:`,
        chain.map((s) => `${s.provider}:${s.status}`).join(' → '),
      );
    }

    // 8. Assignee matching (в commit-фазе — повторно: команда могла измениться
    // между draft и подтверждением)
    const assignedTo = matchAssignee(workers, parsed);

    // 9. Title / description finalization
    const { finalTitle, finalDescription } = finalizeTitles(parsed);

    // Валидация: title обязателен (CHECK constraint tasks_title_check)
    if (!finalTitle || !finalTitle.trim()) {
      return NextResponse.json(
        { error: 'При создании заголовка задачи произошла ошибка. Пожалуйста, попробуйте ещё раз.' },
        { status: 400 }
      );
    }

    // Resolve created_by: profile → worker in this workspace
    let createdBy: string | null = null;
    if (profileId) {
      const { data: creatorWorker } = await supabase
        .from('workers')
        .select('id')
        .eq('source_id', profileId)
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .maybeSingle();
      createdBy = creatorWorker?.id ?? null;
    }

    // Explicit source from caller; default to 'manual'
    const source = bodySource === 'bot' ? 'bot' : 'manual';

    // 10. INSERT tasks
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
      source,
      created_by: createdBy,
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

    // 11. Enrichment
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

    // 12. task_events (parse_rewrite) с метриками fallback-цепочки (F04-12).
    // Двухфазный путь: provider-метрики остались в draft-фазе —
    // помечаем parse_phase='user_confirmed_draft' для аудита.
    await supabase.from('task_events').insert({
      workspace_id: workspaceId,
      task_id: taskId,
      event_type: 'parse_rewrite',
      payload: {
        raw_input: input,
        metadata: source === 'bot' ? { source: 'bot' } : undefined,
        rewritten_title: parsed.rewritten_title,
        rewritten_description: parsed.rewritten_description,
        clarity_score: parsed.clarity_score,
        complexity: parsed.complexity,
        enrichment_strategy: strategy,
        used_rewritten: !!parsed.rewritten_title?.trim(),
        // F04-12: fallback chain audit (null в two-phase commit)
        provider_used: providerUsed,
        fallback_chain: chain.map((s) => ({ provider: s.provider, status: s.status })),
        attempts_ms: attemptsMs > 0 ? attemptsMs : null,
        ...(isConfirmedCommit ? { parse_phase: 'user_confirmed_draft' } : {}),
      },
    });

    // 13. Correction Sheet condition
    const showCorrectionSheet =
      parsed.clarity_score < config.correction_sheet_clarity_threshold ||
      parsed.confidence < 0.8;

    return NextResponse.json({ task, parse: parsed, strategy, showCorrectionSheet });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка AI-создания задачи' },
      { status: 500 }
    );
  }
}
