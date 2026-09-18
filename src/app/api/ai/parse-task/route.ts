/**
 * F-04 AI — Parse Task endpoint (draft phase, two-phase creation).
 *
 * POST /api/ai/parse-task
 * Body: { init_data, input, workspace_id? }
 *
 * Фаза 1 создания задачи в TWA: только распознавание. НЕ создаёт задачу,
 * НЕ пишет в БД — ни tasks, ни enrichment_queue, ни task_events.
 * Реальные INSERT'ы делает POST /api/ai/create-task на фазе подтверждения
 * (параметр `parsed`).
 *
 * Ответ: { parse, strategy, showCorrectionSheet }
 *
 * Based on: onitask_ai_.md §3.6, §4.1 (two-phase draft)
 * Security: onitask_security_.md §1.1 (JSON mode + Zod)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  getDefaultWorkspaceId,
  getUserWorkspaceIds,
} from '../../../../../lib/api-auth';
import { createServerClient } from '../../../../../lib/supabase';
import { prepareTaskDraft } from '../../../../lib/ai/parseAndPrepare';

interface ParseTaskBody {
  init_data?: string;
  input?: string;
  workspace_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ParseTaskBody;
    const { init_data, input, workspace_id: explicitWorkspaceId } = body;

    const auth = await authenticateRequest(init_data);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    if (!input || !input.trim()) {
      return NextResponse.json({ error: 'Поле input обязателен' }, { status: 400 });
    }

    const supabase = createServerClient();
    const profileId = auth.profileId || null;

    // Resolve workspace_id: explicit from body > default from profile membership.
    // Явный ID проверяется на членство (INV-05) — как в create-task.
    const userWorkspaceIds = profileId ? await getUserWorkspaceIds(profileId) : [];
    const workspaceId = explicitWorkspaceId
      ? userWorkspaceIds.includes(explicitWorkspaceId)
        ? explicitWorkspaceId
        : null
      : profileId
        ? ((await getDefaultWorkspaceId(profileId)) ?? null)
        : null;

    if (!workspaceId) {
      if (explicitWorkspaceId) {
        return NextResponse.json(
          { error: 'Доступ запрещён: вы не являетесь участником этого workspace' },
          { status: 403 },
        );
      }
      return NextResponse.json({ error: 'Рабочее пространство не найдено' }, { status: 404 });
    }

    const result = await prepareTaskDraft(supabase, workspaceId, input.trim());
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { parsed, strategy, showCorrectionSheet, provider_used } = result.draft;

    // Как и в create-task: пустой заголовок = ошибка распознавания.
    // (CHECK constraint tasks_title_check не даст вставить такую задачу.)
    const finalTitle = parsed.rewritten_title?.trim() || parsed.title;
    if (!finalTitle || !finalTitle.trim()) {
      return NextResponse.json(
        { error: 'При создании заголовка задачи произошла ошибка. Пожалуйста, попробуйте ещё раз.' },
        { status: 400 },
      );
    }

    console.log(`[F-04][parse-task] draft parsed, provider_used: ${provider_used}`);

    return NextResponse.json({ parse: parsed, strategy, showCorrectionSheet });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка AI-распознавания задачи' },
      { status: 500 },
    );
  }
}