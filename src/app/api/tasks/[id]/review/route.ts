// POST /api/tasks/[id]/review — REV-01: ревью-решение в TWA (approve/fix).
// Атомарно через RPC review_action (мг. 083): approve → done, fix → in_progress +
// причина в комментариях (source='review') + requeue агента через dispatch_outbox.
// Auth — Telegram initData (паттерн POST /api/tasks/[id]/submit).
//
// Право на решение (согласовано 2026-09-13):
//   - admin/owner — всегда (форс-мейдж);
//   - если reviewer_id назначен → только он;
//   - иначе (reviewer_id NULL) → creator задачи (backfill на случай, когда
//     воркспейс выпустил review без назначенного ревьюера).
// Bot-webhook (Telegram-кнопки) решает туда же — через тот же RPC, но actor
// определяется из telegram_id → worker там, где review_action вызывается.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
  getActiveWorkerInWorkspace,
} from '../../../../../../lib/api-auth';
import { enrichTaskRow } from '../../../../../../lib/taskEnrichment';
import type { Database } from '../../../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

const MAX_REASON = 2000;

type ReviewBody = {
  action?: string;
  reason?: string;
  expected_version?: number;
};

/** Маппинг slug-исключений RPC review_action на HTTP-ответы. */
function mapReviewError(message: string): { status: number; error: string } {
  switch (message) {
    case 'invalid_action':
      return { status: 400, error: 'Недопустимое действие' };
    case 'not_found':
      return { status: 404, error: 'Задача не найдена' };
    case 'version_conflict':
      return { status: 409, error: 'Версия задачи изменилась. Обновите данные и повторите.' };
    case 'already_processed':
      return { status: 410, error: 'Задача больше не на проверке' };
    case 'forbidden':
      return { status: 403, error: 'Нет права на решение по этой задаче' };
    default:
      return { status: 500, error: message || 'Не удалось обработать решение' };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(await extractInitData(request));
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error || 'Не авторизован' },
      { status: auth.status || 401 },
    );
  }
  const profileId = auth.profileId!;
  const { id: taskId } = await params;
  const body = (await request.json()) as ReviewBody;

  const action = body.action;
  if (action !== 'approve' && action !== 'fix') {
    return NextResponse.json({ error: 'Недопустимое действие' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (action === 'fix' && reason.length < 1) {
    return NextResponse.json(
      { error: 'Укажите причину возврата на доработку' },
      { status: 400 },
    );
  }
  if (reason.length > MAX_REASON) {
    return NextResponse.json({ error: `Причина длинее ${MAX_REASON} символов` }, { status: 400 });
  }

  const expectedVersion =
    typeof body.expected_version === 'number' ? body.expected_version : null;

  const supabase = createServerClient();

  // Tenancy: задача существует + профиль — активный член её воркспейса.
  const { data: taskRow, error: taskFetchError } = await supabase
    .from('tasks')
    .select('workspace_id, "column", version, created_by, reviewer_id')
    .eq('id', taskId)
    .maybeSingle();
  if (taskFetchError) {
    return NextResponse.json({ error: taskFetchError.message }, { status: 500 });
  }
  if (!taskRow) {
    return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
  }
  if (!(await isWorkspaceMember(profileId, taskRow.workspace_id as string))) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  // Актор — active worker в воркспейсе задачи (R6: resolved server-side).
  const actor = await getActiveWorkerInWorkspace(profileId, taskRow.workspace_id as string);
  if (!actor) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  // REV-01: право на решение.
  const role = actor.role ?? '';
  const isOwnerAdmin = role === 'owner' || role === 'admin';
  const isReviewer = !!taskRow.reviewer_id && actor.id === (taskRow.reviewer_id as string);
  const isCreator =
    !taskRow.reviewer_id &&
    !!taskRow.created_by &&
    actor.id === (taskRow.created_by as string);
  if (!isOwnerAdmin && !isReviewer && !isCreator) {
    return NextResponse.json(
      { error: 'Нет права на решение по этой задаче' },
      { status: 403 },
    );
  }

  // Атомарное решение (RPC, DEFENSE-IN-DEPTH: проверит column=review + version).
  // RPC типизирован в types/supabase.ts (review_action, миграция 083).
  const { data: rpcData, error: rpcError } = await supabase.rpc('review_action', {
    p_task_id: taskId,
    p_action: action,
    p_version: expectedVersion ?? (taskRow.version as number),
    p_actor_worker_id: actor.id,
    p_reason: action === 'fix' ? reason : undefined,
  });

  if (rpcError) {
    const mapped = mapReviewError((rpcError.message ?? '').trim());
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const rpc = (rpcData ?? {}) as { success?: boolean; error?: string; new_column?: string };
  if (rpc.success === false) {
    const mapped = mapReviewError((rpc.error ?? '').trim());
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  // Свежая строка задачи после решения (version/column обновлены триггерами RPC).
  const { data: updated, error: refetchError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();
  if (refetchError || !updated) {
    return NextResponse.json({ error: 'Не удалось прочитать задачу' }, { status: 500 });
  }

  return NextResponse.json({
    task: await enrichTaskRow(updated as TasksRow),
    new_column: rpc.new_column ?? (action === 'approve' ? 'done' : 'in_progress'),
  });
}