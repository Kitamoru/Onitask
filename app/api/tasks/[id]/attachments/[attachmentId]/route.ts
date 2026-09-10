// DELETE /api/tasks/[id]/attachments/[attachmentId] — FILE-05: удалить файл задачи.
// Auth через Telegram initData; tenant-изоляция через workspace задачи.
// Удаляет бинарник из Storage (best-effort) + строку манифеста.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../lib/api-auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const auth = await authenticateRequest(await extractInitData(req));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.status || 401 }
      );
    }
    const { id: taskId, attachmentId } = await params;
    const supabase = createServerClient();

    // Манифест + workspace задачи для tenant-проверки
    const { data: attachment, error: fetchError } = await supabase
      .from('task_attachments')
      .select('id, storage_path, workspace_id')
      .eq('id', attachmentId)
      .eq('task_id', taskId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!attachment) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }
    if (
      !(await isWorkspaceMember(
        auth.profileId!,
        attachment.workspace_id as string
      ))
    ) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // Бинарник из Storage — best-effort (мог быть уже удалён GC)
    const storagePath = attachment.storage_path as string;
    if (storagePath) {
      try {
        await supabase.storage
          .from('task-attachments')
          .remove([storagePath]);
      } catch (storageErr) {
        console.error(
          '[DELETE attachment] storage remove error:',
          storageErr
        );
      }
    }

    // Манифест — фильтр по task_id для defense-in-depth (защита от перепривязки)
    const { error: deleteError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId)
      .eq('task_id', taskId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE attachment] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}