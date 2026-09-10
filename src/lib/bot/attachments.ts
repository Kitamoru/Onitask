// src/lib/bot/attachments.ts — FILE-04: приём файлов от человека в Telegram.
// Сценарии:
//   1. Reply на карточку задачи + файл → прикрепить к задаче (bot_task_messages).
//   2. /attach + файл (без reply) → ждём full_id (bot_attach_pending) → attach.
//   3. /attach + full_id → attach сохранённого из pending файла.
//   4. Файл + caption → задача из caption + attach (после создания задачи).
// Канон: байты → Storage task-attachments, манифест → task_attachments.

import { createClient } from '@supabase/supabase-js';
import {
  sanitizeAttachmentFilename,
  extensionOf,
  EXTENSION_MIME,
} from '../../../lib/shared/attachments';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface BotFileInput {
  fileId: string;
  filename: string;
  mimeHint?: string;
  caption?: string;
}

const TG_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

/** Извлечь файл из Telegram-сообщения (document ИЛИ photo[последний]). */
export function extractFileFromMessage(message: any): BotFileInput | null {
  if (message?.document) {
    return {
      fileId: message.document.file_id,
      filename: message.document.file_name ?? 'document.bin',
      mimeHint: message.document.mime_type,
      caption: message.caption,
    };
  }
  if (
    message?.photo &&
    Array.isArray(message.photo) &&
    message.photo.length > 0
  ) {
    const largest = message.photo[message.photo.length - 1];
    return {
      fileId: largest.file_id,
      filename: `photo_${largest.file_unique_id ?? Date.now()}.jpg`,
      mimeHint: 'image/jpeg',
      caption: message.caption,
    };
  }
  return null;
}

/** Проверить, что расширение файла проходит whitelist. */
export function isAllowedBotFile(filename: string): boolean {
  const ext = extensionOf(filename);
  return (TG_EXT_MIME[ext] ?? EXTENSION_MIME[ext] ?? undefined) !== undefined;
}

/** Скачать файл из Telegram по file_id (getFile → файл по file_path). */
export async function downloadTelegramFileBytes(
  botToken: string,
  fileId: string
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  try {
    const getFileResp = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    if (!getFileResp.ok) return null;
    const getFileData = await getFileResp.json();
    const filePath = getFileData?.result?.file_path;
    const filePathBasename = String(filePath ?? '')
      .split('/')
      .pop() ?? 'file';
    if (!filePath) return null;

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const fileResp = await fetch(downloadUrl);
    if (!fileResp.ok) return null;
    return {
      bytes: new Uint8Array(await fileResp.arrayBuffer()),
      filename: filePathBasename,
    };
  } catch (err) {
    console.error('[Bot Attach] downloadTelegramFileBytes error:', err);
    return null;
  }
}

/**
 * Сохранить файл в Storage task-attachments + строку task_attachments.
 * Автор — человек (source='telegram', author_type='human').
 */
export async function saveAttachmentToTask(opts: {
  workspaceId: string;
  taskId: string;
  userId: number;
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
}): Promise<boolean> {
  const filename = sanitizeAttachmentFilename(opts.filename);
  const ext = extensionOf(filename);
  const mime =
    (opts.mimeType && TG_EXT_MIME[ext] ? TG_EXT_MIME[ext] : undefined) ??
    opts.mimeType ??
    'application/octet-stream';
  const uuidName = `${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  const storagePath = `${opts.workspaceId}/${opts.taskId}/${uuidName}`;

  const { error: uploadError } = await supabase.storage
    .from('task-attachments')
    .upload(storagePath, opts.bytes, { contentType: mime, upsert: false });
  if (uploadError) {
    console.error('[Bot Attach] storage upload error:', uploadError);
    return false;
  }

  const { error: insertError } = await supabase
    .from('task_attachments')
    .insert({
      workspace_id: opts.workspaceId,
      task_id: opts.taskId,
      execution_id: null,
      filename,
      mime_type: mime,
      size_bytes: opts.bytes.length,
      storage_path: storagePath,
      uploaded_by: null,
      author_type: 'human',
      source: 'telegram',
    });
  if (insertError) {
    console.error('[Bot Attach] manifest insert error:', insertError);
    await supabase.storage.from('task-attachments').remove([storagePath]);
    return false;
  }
  return true;
}

/** Буфер файла в bot_attach_pending (ждём full_id). */
export async function setBotAttachPending(opts: {
  workspaceId: string;
  chatId: number;
  userId: number;
  fileId: string;
  filename: string;
}): Promise<boolean> {
  const { error } = await supabase.from('bot_attach_pending').insert({
    workspace_id: opts.workspaceId,
    chat_id: opts.chatId,
    telegram_user_id: opts.userId,
    task_full_id: null,
    file_meta: [
      {
        file_id: opts.fileId,
        filename: opts.filename,
        mime_hint: null,
      },
    ],
    expires_at: new Date(Date.now() + 15 * 60 * 1000),
  });
  if (error) {
    console.error('[Bot Attach] setBotAttachPending error:', error);
    return false;
  }
  return true;
}

/** Прочитать и очистить pending строку чата (атомарно). */
export async function consumeBotAttachPending(
  chatId: number
): Promise<Array<{ file_id: string; filename: string }> | null> {
  const { data } = await supabase
    .from('bot_attach_pending')
    .select('id, file_meta')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;

  const row = data[0];
  await supabase.from('bot_attach_pending').delete().eq('id', row.id);
  const meta = row.file_meta as Array<{ file_id: string; filename: string }>;
  return Array.isArray(meta) ? meta : null;
}

export { supabase as botAttachSupabase };