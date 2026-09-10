// GET/POST /api/tasks/[id]/attachments — FILE-05: файлы задачи (TWA).
// GET  → манифест + signed URL (TTL 1ч) для скачивания.
// POST → multipart-upload в Storage task-attachments + манифест.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '../../../../../../lib/supabase';
import { authenticateRequest, extractInitData, isWorkspaceMember } from '../../../../../../lib/api-auth';
import { createAttachmentSignedUrl } from '../../../../../../lib/shared/attachments';
import {
  sanitizeAttachmentFilename,
  extensionOf,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  EXTENSION_MIME,
} from '../../../../../../lib/shared/attachments';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per file
const MAX_TOTAL_SIZE = 3 * 1024 * 1024; // 3MB total per request
const MAX_FILES = 5;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { data: rows } = await supabase
      .from('task_attachments')
      .select('id, filename, mime_type, size_bytes, storage_path, created_at, author_type, source')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    const attachments = [];
    for (const row of rows ?? []) {
      const url = await createAttachmentSignedUrl(supabase, row.storage_path as string, 3600);
      attachments.push({
        id: row.id,
        filename: row.filename,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        url,
        created_at: row.created_at,
        author_type: row.author_type,
        source: row.source,
      });
    }
    return NextResponse.json({ success: true, attachments });
  } catch (err) {
    console.error('[GET attachments] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const workspaceId = task.workspace_id as string;
    if (!(await isWorkspaceMember(profileId, workspaceId))) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // Автор загрузки: резолвим worker текущего профиля в этом workspace.
    // Если воркер не найден (напр. профиль без human-воркера) — null,
    // колонка uploaded_by должна быть nullable.
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', profileId)
      .eq('workspace_id', workspaceId)
      .eq('type', 'human')
      .maybeSingle();
    const uploadedBy = (worker?.id as string | undefined) ?? null;

    const form = await req.formData();
    const files = form.getAll('files') as File[];
    if (files.length === 0) return NextResponse.json({ error: 'files required' }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `max ${MAX_FILES} files` }, { status: 400 });

    let total = 0;
    for (const f of files) {
      const ext = extensionOf(f.name);
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
        return NextResponse.json({ error: 'invalid_file_type', filename: f.name }, { status: 400 });
      }
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'file_too_large', filename: f.name }, { status: 400 });
      }
      total += f.size;
    }
    if (total > MAX_TOTAL_SIZE) return NextResponse.json({ error: 'total_too_large' }, { status: 400 });

    const { count } = await supabase
      .from('task_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('task_id', taskId);
    if ((count ?? 0) + files.length > MAX_FILES) {
      return NextResponse.json({ error: 'max_files_limit_reached' }, { status: 400 });
    }

    const saved = [];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ext = extensionOf(f.name);
      const mime = EXTENSION_MIME[ext] ?? 'application/octet-stream';
      const uuidName = crypto.randomUUID().replace(/-/g, '');
      const storagePath = `${workspaceId}/${taskId}/${uuidName}.${ext}`;

      // Одно и то же безопасное имя используем в БД и в ответе,
      // чтобы UI после reload не увидел другое значение.
      const safeName = sanitizeAttachmentFilename(f.name);

      const { error: upErr } = await supabase.storage
        .from('task-attachments')
        .upload(storagePath, bytes, { contentType: mime });
      if (upErr) {
        console.error('[POST attachments] storage upload error:', storagePath, upErr);
        continue;
      }

      const { data: row, error: insErr } = await supabase
        .from('task_attachments')
        .insert({
          workspace_id: workspaceId,
          task_id: taskId,
          execution_id: null,
          filename: safeName,
          mime_type: mime,
          size_bytes: bytes.length,
          storage_path: storagePath,
          uploaded_by: uploadedBy,
          author_type: 'human',
          source: 'twa',
        })
        .select()
        .single();
      if (insErr) {
        // Откатываем только что загруженный бинарник (best-effort),
        // ошибку очистки логируем — иначе получим «сироту» в Storage без следов.
        const { error: rmErr } = await supabase.storage
          .from('task-attachments')
          .remove([storagePath]);
        if (rmErr) {
          console.error(
            '[POST attachments] orphan cleanup failed:',
            storagePath,
            rmErr
          );
        }
        console.error('[POST attachments] manifest insert error:', insErr);
        continue;
      }
      const url = await createAttachmentSignedUrl(supabase, storagePath, 3600);
      saved.push({
        id: row.id,
        filename: safeName,
        mime_type: mime,
        size_bytes: bytes.length,
        url,
        created_at: row.created_at,
      });
    }

    // Ни один файл не сохранился — отдаём 500, чтобы клиент показал ошибку,
    // а не «успех с пустым списком».
    if (saved.length === 0) {
      return NextResponse.json(
        { error: 'upload_failed', detail: 'Не удалось загрузить ни один файл' },
        { status: 500 },
      );
    }

    // Частичный успех — 200 + warning, UI может показать предупреждение.
    if (saved.length < files.length) {
      return NextResponse.json({
        success: true,
        attachments: saved,
        warning: `Загружено ${saved.length} из ${files.length}`,
      });
    }

    return NextResponse.json({ success: true, attachments: saved });
  } catch (err) {
    console.error('[POST attachments] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}