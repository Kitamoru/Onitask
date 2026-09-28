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
  type RuntimeAttachmentMeta,
} from './attachments.ts';

export interface AttachmentIngest {
  /** Манифест для metadata терминала (тот же формат, что у MCP-пути). */
  manifest: RuntimeAttachmentMeta[];
  rejected: { filename: string; reason: string }[];
  failed: { filename: string; reason: string }[];
}

/**
 * Размер объекта в бакете или null, если объекта нет.
 *
 * Storage-js не имеет HEAD, поэтому смотрим листингом каталога: у объекта
 * есть имя и size. Возвращаем null именно на «нет объекта», чтобы вызывающий
 * отличил отсутствие файла от сбоя сети.
 */
async function objectSizeBytes(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<number | null> {
  const slash = storagePath.lastIndexOf('/');
  if (slash < 0) return null;
  const dir = storagePath.slice(0, slash);
  const name = storagePath.slice(slash + 1);
  if (!name) return null;

  const { data, error } = await supabase.storage.from('task-attachments').list(dir, {
    search: name,
  });
  if (error) return null;
  const hit = (data ?? []).find((entry) => entry && entry.name === name);
  if (!hit || typeof hit.size !== 'number') return null;
  return hit.size;
}

/** Строка манифеста для уже залитого объекта. false — вставка не удалась. */
async function insertManifestRow(
  supabase: SupabaseClient,
  opts: { workspaceId: string; taskId: string; executionId: string },
  filename: string,
  mime: string,
  sizeBytes: number,
  storagePath: string,
): Promise<boolean> {
  const { error } = await supabase.from('task_attachments').insert({
    workspace_id: opts.workspaceId,
    task_id: opts.taskId,
    execution_id: opts.executionId,
    filename,
    mime_type: mime,
    size_bytes: sizeBytes,
    storage_path: storagePath,
    uploaded_by: null,
    author_type: 'agent',
    source: 'hosted_runtime',
  });
  // Ретрай после частичного успеха упирается в UNIQUE(execution_id, filename).
  // Это НЕ ошибка загрузки — файл уже записан, повторно писать не нужно.
  if (error && !/duplicate key|unique/i.test(error.message)) {
    console.error('[agent-runtime] manifest insert failed:', error.message);
    return false;
  }
  return true;
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
 * content_base64 — штатный путь: байты кладут в ответ, декодируем и грузим мы.
 * storage_path оставлен как защита: агент может придумать путь или подставить
 * путь чужой задачи, и objectSizeBytes обязан отбросить такой файл с причиной,
 * а не записать в манифест запись без байтов.
 *
 * Идемпотентность retry — UNIQUE(execution_id, filename): уже загруженные
 * имена пропускаем. Ошибка на одном файле не роняет прогон: результат уже
 * получен, причина уходит проверяющему в metadata и в журнал прогона.
 */
export async function persistRunAttachments(
  supabase: SupabaseClient,
  opts: { workspaceId: string; taskId: string; executionId: string; raw: unknown },
): Promise<AttachmentIngest> {
  const review = reviewAttachments(opts.raw, {
    workspacePrefix: `${opts.workspaceId}/`,
  });
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

    // Ветка FILE-08: байты агент уже залил сам по одноразовой ссылке. Нам НЕ
    // надо ни декодировать, ни грузить — надо убедиться, что объект реально
    // есть, и записать строку манифеста. Проверка существования обязательна:
    // без неё модель могла бы «приклеить» несуществующий файл к задаче, а
    // GC из миграции 081 снёс бы объект только через час, оставив битую ссылку.
    if (attachment.storage_path) {
      const size = await objectSizeBytes(supabase, attachment.storage_path);
      if (size === null) {
        failed.push({
          filename: attachment.filename,
          reason: 'file was not uploaded to storage at the returned path',
        });
        continue;
      }
      const inserted = await insertManifestRow(
        supabase,
        opts,
        attachment.filename,
        mime,
        size,
        attachment.storage_path,
      );
      if (inserted) {
        manifest.push({
          filename: attachment.filename,
          mime_type: mime,
          size_bytes: size,
          storage_path: attachment.storage_path,
        });
        already.add(attachment.filename);
      }
      continue;
    }

    const bytes = base64ToBytes(attachment.content_base64);
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
