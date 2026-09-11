// POST/DELETE /api/tasks/[id]/attachments/[attachmentId] — FILE-05/10.
// POST   → on-demand выдача прокси-URL скачивания (HMAC-токен, TTL 5 мин) —
//          пользователь получает ссылку на НАШ домен, а не на supabase.
// DELETE → удалить файл задачи.
// Auth через Telegram initData; tenant-изоляция через workspace задачи.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../../lib/api-auth';
import { mintAttachmentDownloadToken } from '../../../../../../../lib/shared/downloadToken';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const auth = await authenticateRequest(await extractInitData(req));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.status || 401 },
      );
    }
    const { id: taskId, attachmentId } = await params;
    const supabase = createServerClient();

    // Манифест + workspace задачи для tenant-проверки
    const { data: attachment, error: fetchError } = await supabase
      .from('task_attachments')
      .select('id, storage_path, filename, workspace_id')
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
        attachment.workspace_id as string,
      ))
    ) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const storagePath = attachment.storage_path as string;
    if (!storagePath) {
      return NextResponse.json({ error: 'Файл отсутствует в хранилище' }, { status: 404 });
    }

    // Прокси-URL на нашем домене + capability-токен (самоавторизующийся —
    // Telegram.WebApp.downloadFile делает нативный запрос без заголовков)
    const origin = process.env.NEXT_PUBLIC_WEBAPP_URL || new URL(req.url).origin;
    const token = mintAttachmentDownloadToken(taskId, attachmentId);
    const url = `${origin}/api/tasks/${taskId}/attachments/${attachmentId}/file?t=${token}`;

    return NextResponse.json({ success: true, url, filename: attachment.filename });
  } catch (err) {
    console.error('[POST attachment sign] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const auth = await authenticateRequest(await extractInitData(req));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.status || 401 },
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
        attachment.workspace_id as string,
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
          storageErr,
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
