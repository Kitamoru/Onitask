// GET /api/tasks/[id]/attachments/[attachmentId]/file?t=<token> — FILE-10.
// Прокси-скачивание на нашем домене (supabase-URL не попадает к пользователю).
// Токен — capability (HMAC, TTL 5 мин, scope taskId+attachmentId), выдаётся
// через POST [attachmentId] после initData + isWorkspaceMember.
// Имя файла — RFC 5987 (filename*=UTF-8''), иначе кириллица → тарабарщина.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../../../lib/supabase';
import { verifyAttachmentDownloadToken } from '../../../../../../../../lib/shared/downloadToken';

/** ASCII-safe fallback для filename= (filename* держит UTF-8). */
function asciiFallback(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return ascii || 'file';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: taskId, attachmentId } = await params;
    const token = req.nextUrl.searchParams.get('t');
    if (!verifyAttachmentDownloadToken(token, taskId, attachmentId)) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или истекла' },
        { status: 403 },
      );
    }

    const supabase = createServerClient();
    const { data: attachment, error: fetchError } = await supabase
      .from('task_attachments')
      .select('storage_path, filename, mime_type')
      .eq('id', attachmentId)
      .eq('task_id', taskId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!attachment?.storage_path) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const { data: blob, error: dlError } = await supabase.storage
      .from('task-attachments')
      .download(attachment.storage_path as string);
    if (dlError || !blob) {
      console.error('[GET attachment file] storage download error:', dlError);
      return NextResponse.json({ error: 'Не удалось получить файл' }, { status: 500 });
    }

    const filename = (attachment.filename as string) || 'file';
    return new Response(blob, {
      headers: {
        'Content-Type': (attachment.mime_type as string) || 'application/octet-stream',
        // RFC 5987/6266: filename* — UTF-8 (кириллица), filename= — ASCII fallback
        'Content-Disposition': `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[GET attachment file] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
