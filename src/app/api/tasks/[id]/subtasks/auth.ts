'use server';

/**
 * Авторизация для маршрутов подзадач (`/api/tasks/[id]/subtasks`).
 *
 * SUB-01: подзадача — строка в `tasks` с `parent_task_id` (миграции 139–142),
 * поэтому права на неё те же, что у обычной задачи, и берутся из того же
 * чистого модуля `getTaskPermission`, что и у PATCH /api/tasks/[id].
 *
 * Вынесено отдельно, чтобы GET и POST не расходились в проверках — тот же
 * приём, что `getAuthorizedTask` в relations/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../lib/api-auth';

export interface AuthorizedTaskContext {
  supabase: ReturnType<typeof createServerClient>;
  task: {
    id: string;
    workspace_id: string;
    parent_task_id: string | null;
    created_by: string | null;
    assigned_to: string | null;
    column: string;
  };
  profileId: string;
}

/**
 * Задача существует + профиль — активный член её воркспейса.
 *
 * Родитель и подзадача отвечают одинаково (404), чтобы роут не подтверждал
 * существование чужой задачи — тот же resource-scoped подход, что у
 * PATCH /api/tasks/[id].
 */
export async function getAuthorizedTask(
  request: NextRequest,
  taskId: string,
): Promise<AuthorizedTaskContext | { error: NextResponse }> {
  const auth = await authenticateRequest(await extractInitData(request));
  if (!auth.authenticated) {
    return {
      error: NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      ),
    };
  }

  const profileId = auth.profileId!;
  const supabase = createServerClient();
  const { data: task, error } = await supabase
    .from('tasks')
    .select('id, workspace_id, parent_task_id, created_by, assigned_to, "column"')
    .eq('id', taskId)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!task) {
    return { error: NextResponse.json({ error: 'Задача не найдена' }, { status: 404 }) };
  }
  if (!(await isWorkspaceMember(profileId, task.workspace_id as string))) {
    return { error: NextResponse.json({ error: 'Задача не найдена' }, { status: 404 }) };
  }

  return {
    supabase,
    task: task as unknown as AuthorizedTaskContext['task'],
    profileId,
  };
}
