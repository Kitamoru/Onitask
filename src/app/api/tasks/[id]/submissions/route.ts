// GET /api/tasks/[id]/submissions — SUBMIT-01: последняя сдача задачи.
// Используется TWA для префилла формы «Результат» при review→done
// (текст/ссылки исполнителя переносятся в форму ревьюера).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../lib/api-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(await extractInitData(req));
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 });
    }
    const profileId = auth.profileId!;
    const { id: taskId } = await params;
    const supabase = createServerClient();

    const { data: task } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    if (!(await isWorkspaceMember(profileId, task.workspace_id as string))) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // Последняя сдача (для префилла важен именно последний артефакт).
    const { data: submission } = await supabase
      .from('task_submissions')
      .select('id, body_text, links, target_column, status, accepted_by, accepted_at, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!submission) {
      return NextResponse.json({ submission: null });
    }

    // Файлы, привязанные к этой сдаче (только счётчик — префилл файлов read-only).
    const { count } = await supabase
      .from('task_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('submission_id', submission.id);

    return NextResponse.json({
      submission: {
        id: submission.id,
        body_text: submission.body_text,
        links: submission.links,
        target_column: submission.target_column,
        status: submission.status,
        accepted_by: submission.accepted_by,
        accepted_at: submission.accepted_at,
        created_at: submission.created_at,
        files_count: count ?? 0,
      },
    });
  } catch (err) {
    console.error('[GET submissions] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
