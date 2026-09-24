// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
// supabase/functions/agent-runtime/attachments.ts
// Файлы-артефакты, которые внешний агент вернул внутри JSON-ответа.
//
// Паритет с каноническим слоем lib/shared/attachments.ts (FILE-01): тот же
// whitelist расширений, та же проверка магии байтов, те же лимиты (≤5 файлов,
// ≤2 МБ base64 на файл, ≤3 МБ суммарно). Дублирование осознанное: Edge
// Function деплоится своим каталогом и импортировать lib/ не может.
//
// Отличие от MCP-пути (opsTerminalCore): невалидный файл НЕ роняет прогон —
// он отбрасывается с причиной, потому что результат уже оплачен попыткой.
// Причины отказа уходят в metadata результата и в журнал прогона.
//
// Модуль чистый (никаких Deno/сетевых API): загрузка — в index.ts.
// `crypto.randomUUID` и `atob` доступны и в Edge Runtime, и в node-env тестов.

export interface RuntimeAttachmentInput {
  filename: string;
  content_base64: string;
  caption?: string;
}

/** Элемент манифеста: ровно те поля, что кладёт MCP-путь (AttachmentMeta). */
export interface RuntimeAttachmentMeta {
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}

export interface RuntimeAttachmentReview {
  accepted: RuntimeAttachmentInput[];
  rejected: { filename: string; reason: string }[];
}

// ============================================================================
// Лимиты и whitelist (1:1 с lib/shared/attachments.ts)
// ============================================================================

export const MAX_ATTACHMENTS = 5;
export const MAX_ONE_BASE64_LENGTH = 2 * 1024 * 1024; // 2MB base64 (~1.5MB bin)
export const MAX_TOTAL_BASE64_LENGTH = 3 * 1024 * 1024; // 3MB base64 суммарно
export const MAX_FILENAME_LENGTH = 120;

export const ALLOWED_EXTENSIONS = new Set([
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
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

// ============================================================================
// Helpers
// ============================================================================

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Имя без path-traversal: только basename, обрезанный по длине. */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? 'file';
  return base.slice(-MAX_FILENAME_LENGTH);
}

export function base64ToBytes(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Магия байтов: содержимое должно соответствовать расширению, иначе
 * переименованный .exe в chart.png прошёл бы валидацию.
 */
export function sniffMatches(mime: string, bytes: Uint8Array): boolean {
  const startsWith = (...seq: number[]) => {
    if (bytes.length < seq.length) return false;
    for (let i = 0; i < seq.length; i += 1) {
      if (bytes[i] !== seq[i]) return false;
    }
    return true;
  };
  const asciiAt = (offset: number, expected: string) => {
    if (bytes.length < offset + expected.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
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
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // OLE2
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/zip':
      // docx/xlsx/pptx — zip-контейнеры (PK\x03\x04)
      return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06);
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
      // Текст: без бинарной магии и без NUL в первых 512 байтах
      const probe = Math.min(bytes.length, 512);
      for (let i = 0; i < probe; i += 1) {
        if (bytes[i] === 0) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// Проверка массива attachments из ответа агента
// ============================================================================

/**
 * Разбирает `attachments` из JSON-ответа агента. Каждый элемент проверяется
 * независимо: плохой файл отбрасывается с причиной, остальные проходят.
 */
export function reviewAttachments(raw: unknown): RuntimeAttachmentReview {
  const accepted: RuntimeAttachmentInput[] = [];
  const rejected: { filename: string; reason: string }[] = [];

  if (raw === undefined || raw === null) return { accepted, rejected };
  if (!Array.isArray(raw)) {
    return { accepted, rejected: [{ filename: '—', reason: 'attachments must be an array' }] };
  }

  let totalBase64 = 0;

  raw.forEach((item, index) => {
    const label = `#${index + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      rejected.push({ filename: label, reason: 'item is not an object' });
      return;
    }

    const record = item as Record<string, unknown>;
    const rawName = String(record.filename ?? '').trim();
    const filename = sanitizeFilename(rawName);
    const contentBase64 = String(record.content_base64 ?? '').trim();

    if (accepted.length >= MAX_ATTACHMENTS) {
      rejected.push({ filename: filename || label, reason: `more than ${MAX_ATTACHMENTS} files` });
      return;
    }
    if (!rawName || !filename || /[/\\]|\.\./.test(rawName)) {
      rejected.push({ filename: filename || label, reason: 'invalid filename' });
      return;
    }
    if (!contentBase64) {
      rejected.push({ filename, reason: 'content_base64 is empty' });
      return;
    }

    const ext = extensionOf(filename);
    const mime = EXTENSION_MIME[ext];
    if (!mime || !ALLOWED_EXTENSIONS.has(ext)) {
      rejected.push({ filename, reason: `unsupported file type: ${ext || '<none>'}` });
      return;
    }
    if (contentBase64.length > MAX_ONE_BASE64_LENGTH) {
      rejected.push({ filename, reason: 'file too large (base64 > 2MB)' });
      return;
    }
    if (totalBase64 + contentBase64.length > MAX_TOTAL_BASE64_LENGTH) {
      rejected.push({ filename, reason: 'total attachments size exceeds 3MB (base64)' });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(contentBase64);
    } catch {
      rejected.push({ filename, reason: 'invalid base64' });
      return;
    }
    if (bytes.length === 0) {
      rejected.push({ filename, reason: 'decoded file is empty' });
      return;
    }
    if (!sniffMatches(mime, bytes)) {
      rejected.push({ filename, reason: `content does not match declared type: ${ext}` });
      return;
    }

    totalBase64 += contentBase64.length;
    const caption = record.caption ? String(record.caption).slice(0, 1024) : undefined;
    accepted.push(
      caption
        ? { filename, content_base64: contentBase64, caption }
        : { filename, content_base64: contentBase64 },
    );
  });

  return { accepted, rejected };
}
