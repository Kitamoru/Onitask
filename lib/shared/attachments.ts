// lib/shared/attachments.ts
// FILE-01..: общий слой валидации/загрузки файлов задач.
// Канон хранения: бинарник → Supabase Storage bucket 'task-attachments',
// в БД (task_attachments) — только манифест. base64 — ТОЛЬКО транспорт
// для канала агента (JSON MCP), декодируется здесь и умирает.
//
// Безопасность: whitelist расширений (app-level, НЕ CHECK в БД) +
// проверка магии байтов (первые байты файла) — переименованный .exe
// в chart.png не пройдёт. Лимиты: ≤5 файлов, ≤2MB base64 на файл,
// ≤3MB base64 суммарно.

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Whitelist — ключевые типы (решение владельца, раздел 3)
// ============================================================================

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'pdf',
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
  'csv', 'txt', 'md',
  'zip',
  'ogg', 'mp3',
]);

export const EXTENSION_MIME: Record<string, string> = {
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

// ============================================================================
// Лимиты (то же, что на канале агента и в TWA)
// ============================================================================

export const MAX_ATTACHMENTS_PER_TASK = 5;
export const MAX_ONE_BASE64_BYTES = 2 * 1024 * 1024; // 2MB base64 (~1.5MB bin)
export const MAX_TOTAL_BASE64_BYTES = 3 * 1024 * 1024; // 3MB base64 суммарно
export const MAX_FILENAME_LENGTH = 120;

// ============================================================================
// Types
// ============================================================================

export interface AttachmentInput {
  filename: string;
  content_base64: string;
  caption?: string;
}

export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(`attachments: ${message}`);
    this.name = 'AttachmentValidationError';
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function sanitizeAttachmentFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? 'file';
  return base.slice(-MAX_FILENAME_LENGTH);
}

export function base64ToBytes(contentBase64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(contentBase64, 'base64'));
}

/**
 * Проверка магии байтов: реальные первые байты должны соответствовать
 * заявленному типу. Для text/* — запрет бинарных сигнатур.
 */
export function sniffMatches(mime: string, bytes: Uint8Array): boolean {
  const startsWith = (...seq: number[]) => {
    if (bytes.length < seq.length) return false;
    for (let i = 0; i < seq.length; i++) {
      if (bytes[i] !== seq[i]) return false;
    }
    return true;
  };
  const asciiAt = (offset: number, expected: string) => {
    if (bytes.length < offset + expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (bytes[offset + i] !== expected.charCodeAt(i)) return false;
    }
    return true;
  };

  switch (mime) {
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/gif':
      return asciiAt(0, 'GIF87a') || asciiAt(0, 'GIF89a');
    case 'image/webp':
      return asciiAt(0, 'RIFF') && asciiAt(8, 'WEBP');
    case 'application/pdf':
      return asciiAt(0, '%PDF-');
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      // OLE2 compound file (старые doc/xls/ppt)
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/zip':
      // ZIP local file header PK\x03\x04 (docx/xlsx/pptx = zip-контейнеры)
      return (
        startsWith(0x50, 0x4b, 0x03, 0x04) ||
        startsWith(0x50, 0x4b, 0x05, 0x06)
      );
    case 'audio/ogg':
      return asciiAt(0, 'OggS');
    case 'audio/mpeg':
      return (
        asciiAt(0, 'ID3') ||
        startsWith(0xff, 0xfb) ||
        startsWith(0xff, 0xf3) ||
        startsWith(0xff, 0xf2)
      );
    case 'text/csv':
    case 'text/plain':
    case 'text/markdown': {
      // Текст: не начинаемся с бинарной магии и нет NUL в первых 512 байтах
      const probe = Math.min(bytes.length, 512);
      for (let i = 0; i < probe; i++) {
        if (bytes[i] === 0) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// Валидация массива attachments от агента (ops_terminal / send_message_to_chat)
// ============================================================================

export function validateAttachments(raw: unknown): AttachmentInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new AttachmentValidationError('must be an array.');
  }
  if (raw.length > MAX_ATTACHMENTS_PER_TASK) {
    throw new AttachmentValidationError(
      `at most ${MAX_ATTACHMENTS_PER_TASK} files allowed.`
    );
  }

  const out: AttachmentInput[] = [];
  let totalB64 = 0;

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      throw new AttachmentValidationError('each item must be an object.');
    }
    const rawFilename = String(
      (item as { filename?: unknown }).filename ?? ''
    ).trim();
    if (/[/\\]|\.\./.test(rawFilename)) {
      throw new AttachmentValidationError(`invalid filename: ${rawFilename}`);
    }
    const filename = sanitizeAttachmentFilename(rawFilename);
    const contentBase64 = String(
      (item as { content_base64?: unknown }).content_base64 ?? ''
    ).trim();

    if (!filename || contentBase64.length === 0) {
      throw new AttachmentValidationError(
        'filename and content_base64 are required for every attachment.'
      );
    }

    const ext = extensionOf(filename);
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
      throw new AttachmentValidationError(`unsupported file type: ${filename}`);
    }
    if (contentBase64.length > MAX_ONE_BASE64_BYTES) {
      throw new AttachmentValidationError(`file too large: ${filename}`);
    }
    totalB64 += contentBase64.length;
    if (totalB64 > MAX_TOTAL_BASE64_BYTES) {
      throw new AttachmentValidationError(
        'total attachments size exceeds 3MB (base64).'
      );
    }

    // Магия байтов — контент должен соответствовать расширению
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(contentBase64);
    } catch {
      throw new AttachmentValidationError(`invalid base64 in ${filename}`);
    }
    const mime = EXTENSION_MIME[ext];
    if (!sniffMatches(mime, bytes)) {
      throw new AttachmentValidationError(
        `content does not match declared type: ${filename}`
      );
    }

    out.push({
      filename,
      content_base64: contentBase64,
      caption: (item as { caption?: unknown }).caption
        ? String((item as { caption?: unknown }).caption).slice(0, 1024)
        : undefined,
    });
  }

  return out;
}

// ============================================================================
// Загрузка в Storage + строка task_attachments
// ============================================================================

export async function uploadAttachmentToStorage(opts: {
  supabase: SupabaseClient;
  workspaceId: string;
  taskId: string;
  executionId?: string | null;
  filename: string;
  contentBase64: string;
  source: 'twa' | 'telegram' | 'mcp';
  authorType: 'human' | 'agent';
  uploadedBy?: string | null;
}): Promise<AttachmentMeta> {
  const supabase = opts.supabase;
  const bytes = base64ToBytes(opts.contentBase64);
  const ext = extensionOf(opts.filename);
  const mime = EXTENSION_MIME[ext] ?? 'application/octet-stream';
  const uuidName = `${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  const storagePath = `${opts.workspaceId}/${opts.taskId}/${uuidName}`;

  const { error: uploadError } = await supabase.storage
    .from('task-attachments')
    .upload(storagePath, bytes, {
      contentType: mime,
      upsert: false,
    });
  if (uploadError) {
    throw new Error(
      `uploadAttachmentToStorage: storage upload failed: ${uploadError.message}`
    );
  }

  const { data: row, error: insertError } = await supabase
    .from('task_attachments')
    .insert({
      workspace_id: opts.workspaceId,
      task_id: opts.taskId,
      execution_id: opts.executionId ?? null,
      filename: opts.filename,
      mime_type: mime,
      size_bytes: bytes.length,
      storage_path: storagePath,
      uploaded_by: opts.uploadedBy ?? null,
      author_type: opts.authorType,
      source: opts.source,
    })
    .select()
    .single();

  if (insertError || !row) {
    // Откат: не оставляем сироту в Storage, если манифест не записался
    await supabase.storage.from('task-attachments').remove([storagePath]);
    throw new Error(
      `uploadAttachmentToStorage: manifest insert failed: ${insertError?.message ?? 'no row'}`
    );
  }

  return {
    filename: opts.filename,
    mime_type: mime,
    size_bytes: bytes.length,
    storage_path: storagePath,
  };
}

export async function createAttachmentSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  ttlSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('task-attachments')
    .createSignedUrl(storagePath, ttlSeconds);
  return error || !data ? null : data.signedUrl;
}

export async function removeAttachmentsFromStorage(
  supabase: SupabaseClient,
  storagePaths: string[]
): Promise<void> {
  if (!storagePaths.length) return;
  try {
    await supabase.storage.from('task-attachments').remove(storagePaths);
  } catch (err) {
    console.error('removeAttachmentsFromStorage error:', err);
  }
}

// ============================================================================
// Reply-маппинг bot_task_messages (FILE-02)
// ============================================================================

export async function rememberBotTaskMessage(opts: {
  supabase: SupabaseClient;
  workspaceId: string;
  taskId: string;
  chatId: number;
  messageId: number;
}): Promise<void> {
  try {
    await opts.supabase
      .from('bot_task_messages')
      .upsert(
        {
          workspace_id: opts.workspaceId,
          task_id: opts.taskId,
          chat_id: opts.chatId,
          message_id: opts.messageId,
        },
        { onConflict: 'chat_id,message_id', ignoreDuplicates: true }
      );
  } catch (err) {
    console.error('rememberBotTaskMessage error:', err);
  }
}

export async function resolveTaskIdByReply(opts: {
  supabase: SupabaseClient;
  chatId: number;
  messageId: number;
}): Promise<string | null> {
  const { data } = await opts.supabase
    .from('bot_task_messages')
    .select('task_id')
    .eq('chat_id', opts.chatId)
    .eq('message_id', opts.messageId)
    .maybeSingle();
  return data ? (data.task_id as string) : null;
}