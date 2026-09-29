// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
// supabase/functions/agent-runtime/persistAttachments.ts
// Загрузка файлов агента: бинарник → Storage, манифест → task_attachments.
//
// Вынесено из index.ts, который импортирует `https://esm.sh/...` и потому
// не загружается в vitest. Здесь только тип клиента (`import type` стирается
// при сборке), поэтому функцию можно вызвать в тесте с подставным клиентом
// и проверить поведение — в том числе дедуп по имени, который иначе
// пришлось бы проверять регуляркой по тексту (AGENTS.md §5).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  base64ToBytes,
  EXTENSION_MIME,
  extensionOf,
  reviewAttachments,
  sniffMatches,
  type RuntimeAttachmentMeta,
} from './attachments.ts';

/** Потолок забора: ровно лимит бакета task-attachments (file_size_limit). */
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
/** Таймаут одного GET. Согласовано с потолком прогона, но не занимает его. */
const ARTIFACT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Собирает URL артефакта ОТ base_url коннектора, а не от модели.
 *
 * Это граница безопасности: путь приходит из недоверенного ответа (task
 * description тоже попадает в промт), поэтому единственный источник хоста —
 * настройка коннектора. Никакой схемы, никакого абсолютного пути, никакого
 * `..` (это проверяется ещё в reviewAttachments, здесь — страховка). Редиректы
 * запрещены на уровне fetch: иначе `https://drift…/redirect?to=169.254.169.254`
 * обошёл бы проверку хоста.
 *
 * Drift отдаёт файлы по схеме <base>/files/<путь в workspace> — это зафиксировано
 * пробой его инструмента deliver_file, который печатает `/v1/files/<name>`.
 */
export function resolveArtifactUrl(baseUrl: string, sourcePath: string): URL | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:') return null;
  if (!sourcePath || sourcePath.includes('..') || sourcePath.startsWith('/')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(sourcePath)) return null;

  const prefix = base.pathname.replace(/\/+$/, '');
  let target: URL;
  try {
    target = new URL(`${prefix}/files/${sourcePath.split('/').map(encodeURIComponent).join('/')}`, base.origin);
  } catch {
    return null;
  }
  // Хост берётся из origin коннектора, так что проверка почти формальная —
  // но она ловит неверный base_url, и стоит ноль.
  return target.host === base.host ? target : null;
}

/**
 * GET артефакта. Возвращает байты либо причину: вызывающий пишет её в
 * `attachments_failed`, поэтому текст должен быть коротким и без URL —
 * адрес может нести токен.
 */
export async function fetchArtifactBytes(
  url: URL,
  apiKey: string,
): Promise<{ bytes: Uint8Array } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTIFACT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: '*/*' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return { error: `artifact fetch failed: HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return { error: 'artifact is empty' };
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      return { error: `artifact is larger than the 2MB bucket limit (${bytes.length} bytes)` };
    }
    return { bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `artifact fetch failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

export interface AttachmentIngest {
  /** Манифест для metadata терминала (тот же формат, что у MCP-пути). */
  manifest: RuntimeAttachmentMeta[];
  rejected: { filename: string; reason: string }[];
  failed: { filename: string; reason: string }[];
}

// FILE-08 (одноразовая ссылка на загрузку) удалён 2026-09-28 вместе с
// UPLOAD_URL_TTL_SECONDS. Ссылка была исправна — баг был в том, что агенту
// дали невыполнимую инструкцию: Drift получил signedUrl, вернул правильный
// storage_path, отчитался «Файл успешно загружен в Storage», а объекта в бакете
// не было. Причина не в формате URL (его чинили дважды) и не в бейте: модель
// не умеет заливать по HTTP, но предпочла это фолбэку, который сработал бы.
//
// Не возвращать minting без смены промта: одно только наличие ссылки в
// RunRequest делает заливку основным путём и воспроизводит этот же кейс.

/**
 * Кладёт файлы агента туда же, куда и MCP-путь (opsTerminalCore): бинарник →
 * Storage 'task-attachments' (приватный), манифест → task_attachments.
 *
 * source_path — штатный путь: файл создан инструментом агента в его workspace,
 * а мы забираем байты GET-ом с хоста коннектора и грузим в Storage сами.
 * content_base64 оставлен для агентов, которые файловые инструменты не имеют.
 *
 * Ветка storage_path удалена 2026-09-29 вместе с objectSizeBytes. Легитимного
 * producer'а у неё не осталось (промт путь в наш бакет не упоминает), а сама она
 * была не защитой, а дырой: объект чужой задачи того же воркспейса существует,
 * проверка проходила, и файл молча приклеивался. Теперь storage_path отвечает
 * модели тем же, что и голое имя, — claimed_files, то есть потеря видна.
 *
 * Идемпотентность retry — UNIQUE(execution_id, filename): уже загруженные
 * имена пропускаем. Ошибка на одном файле не роняет прогон: результат уже
 * получен, причина уходит проверяющему в metadata и в журнал прогона.
 */
export async function persistRunAttachments(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string;
    taskId: string;
    executionId: string;
    raw: unknown;
    /** base_url коннектора: единственный источник хоста для забора файла. */
    baseUrl: string;
    /** Ключ агента — авторизация GET к его собственному API. */
    apiKey: string;
  },
): Promise<AttachmentIngest> {
  const review = reviewAttachments(opts.raw);
  if (review.accepted.length === 0) {
    return { manifest: [], rejected: review.rejected, failed: [] };
  }

  const { data: existing } = await supabase
    .from('task_attachments')
    .select('filename')
    .eq('execution_id', opts.executionId);
  const already = new Set(
    ((existing as { filename: string }[] | null) ?? []).map((row) => row.filename),
  );

  const manifest: RuntimeAttachmentMeta[] = [];
  const failed: { filename: string; reason: string }[] = [];

  for (const attachment of review.accepted) {
    if (already.has(attachment.filename)) continue;

    const ext = extensionOf(attachment.filename);
    const mime = EXTENSION_MIME[ext] ?? 'application/octet-stream';

    // Ветка source_path: байты забираем сами с хоста коннектора. Именно этот
    // путь снимает потолок ответа — файл любого размера, и он настоящий,
    // а не набранный моделью base64.
    let bytes: Uint8Array;
    if (attachment.source_path) {
      const url = resolveArtifactUrl(opts.baseUrl, attachment.source_path);
      if (!url) {
        failed.push({
          filename: attachment.filename,
          reason: 'source_path is not a fetchable path on the connector host',
        });
        continue;
      }
      const fetched = await fetchArtifactBytes(url, opts.apiKey);
      if ('error' in fetched) {
        failed.push({ filename: attachment.filename, reason: fetched.error });
        continue;
      }
      bytes = fetched.bytes;
      // Магия байтов — та же проверка, что и для base64: без неё переименованный
      // .exe прошёл бы под .png. Для base64 она живёт в reviewAttachments,
      // здесь файла ещё не было, поэтому проверяем сами.
      if (!sniffMatches(mime, bytes)) {
        failed.push({
          filename: attachment.filename,
          reason: `content does not match declared type: ${ext}`,
        });
        continue;
      }
    } else {
      bytes = base64ToBytes(attachment.content_base64);
    }

    const storagePath = `${opts.workspaceId}/${opts.taskId}/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('task-attachments')
      .upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (uploadError) {
      failed.push({ filename: attachment.filename, reason: uploadError.message });
      continue;
    }

    const { error: insertError } = await supabase.from('task_attachments').insert({
      workspace_id: opts.workspaceId,
      task_id: opts.taskId,
      execution_id: opts.executionId,
      filename: attachment.filename,
      mime_type: mime,
      size_bytes: bytes.length,
      storage_path: storagePath,
      uploaded_by: null,
      author_type: 'agent',
      source: 'hosted_runtime',
    });
    if (insertError) {
      // Откат: не оставляем сироту в Storage без строки манифеста.
      await supabase.storage.from('task-attachments').remove([storagePath]);
      failed.push({ filename: attachment.filename, reason: insertError.message });
      continue;
    }

    manifest.push({
      filename: attachment.filename,
      mime_type: mime,
      size_bytes: bytes.length,
      storage_path: storagePath,
    });
    // Имя добавляем в `already` СРАЗУ. Иначе два элемента с одинаковым именем
    // в одной пачке (например, из `attachments` и из `report`) дают вторую
    // вставку, которая ловит UNIQUE(execution_id, filename) и попадает в
    // `failed` с причиной, выглядящей как ошибка загрузки файла.
    already.add(attachment.filename);
  }

  return { manifest, rejected: review.rejected, failed };
}
