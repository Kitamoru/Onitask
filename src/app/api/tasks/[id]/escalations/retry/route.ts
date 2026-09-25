'use server';

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
  isWorkspaceMember,
} from '../../../../../../../lib/api-auth';

const ERROR_STATUS: Record<string, number> = {
  invalid_request: 400,
  forbidden: 403,
  task_not_found: 404,
  task_done: 409,
  task_blocked: 409,
  task_already_claimed: 409,
  agent_not_assigned: 409,
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'Не удалось запустить задачу повторно',
  forbidden: 'Нет доступа к рабочей области',
  task_not_found: 'Задача не найдена',
  task_done: 'Завершённую задачу нельзя запустить повторно',
  task_blocked: 'Сначала снимите блокировку задачи',
  task_already_claimed: 'Задача уже выполняется',
  agent_not_assigned: 'Задача не назначена активному AI-агенту',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { id: taskId } = await params;
    const supabase = createServerClient();
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();
    if (taskError) {
      return NextResponse.json({ error: taskError.message }, { status: 500 });
    }
    if (!task || !(await isWorkspaceMember(auth.profileId!, task.workspace_id))) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    const actor = await getActiveWorkerInWorkspace(auth.profileId!, task.workspace_id);
    if (!actor) {
      return NextResponse.json({ error: 'Нет доступа к рабочей области' }, { status: 403 });
    }

    const { data, error } = await (supabase as any).rpc('operator_retry_escalation', {
      p_workspace_id: task.workspace_id,
      p_task_id: taskId,
      p_actor_worker_id: actor.id,
    });
    const result = data as Record<string, unknown> | null;
    const code = result?.error && typeof result.error === 'object'
      ? (result.error as { code?: string }).code
      : undefined;
    if (error || code) {
      const message = code
        ? ERROR_MESSAGES[code] ?? 'Не удалось запустить задачу повторно'
        : 'Не удалось запустить задачу повторно';
      return NextResponse.json(
        { error: message },
        { status: code ? ERROR_STATUS[code] ?? 409 : 500 },
      );
    }
    if (!result?.success) {
      return NextResponse.json({ error: 'Не удалось запустить задачу повторно' }, { status: 500 });
    }

    try {
      await supabase.channel('flowboard-metrics').send({
        type: 'broadcast',
        event: 'task_changed',
        payload: { workspace_id: task.workspace_id, task_id: taskId, escalation_retried: true },
      });
    } catch { /* best effort */ }

    return NextResponse.json(result);
  } catch (err) {
    console.error('escalations/retry: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Не удалось запустить задачу повторно' },
      { status: 500 },
    );
  }
}
