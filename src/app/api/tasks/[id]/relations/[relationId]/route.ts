'use server';

/** DELETE /api/tasks/:id/relations/:relationId — remove one explicit blocker. */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../../lib/api-auth';

type Params = { params: Promise<{ id: string; relationId: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || 'Не авторизован' }, { status: auth.status || 401 });
    }

    const { id: taskId, relationId } = await params;
    const supabase = createServerClient();
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();
    if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });
    if (!task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    if (!(await isWorkspaceMember(auth.profileId!, task.workspace_id))) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    const anySupabase = supabase as any;
    const { data, error } = await anySupabase.rpc('delete_task_block_relation', {
      p_workspace_id: task.workspace_id,
      p_task_id: taskId,
      p_relation_id: relationId,
    });
    if (error) {
      const errorMessage = error.message;
      const status = ['relation_not_found', 'relation_not_for_task', 'only_blocks_are_supported'].includes(errorMessage)
        ? 404
        : 500;
      const message = status === 404 ? 'Связь не найдена для этой задачи' : 'Не удалось удалить связь';
      return NextResponse.json({ error: message }, { status });
    }

    try {
      const affected = data as unknown as { affected_task?: { id?: string } } | null;
      await supabase.channel('flowboard-metrics').send({
        type: 'broadcast',
        event: 'task_changed',
        payload: {
          workspace_id: task.workspace_id,
          task_id: affected?.affected_task?.id,
          relations_changed: true,
        },
      });
    } catch { /* best effort */ }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Не удалось удалить связь' },
      { status: 500 },
    );
  }
}
