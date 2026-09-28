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
 * Кладёт файлы агента туда же, куда и MCP-путь (opsTerminalCore): бинарник →
 * Storage 'task-attachments' (приватный), манифест → task_attachments.
 *
 * Идемпотентность retry — UNIQUE(execution_id, filename): уже загруженные
 * имена пропускаем. Ошибка на одном файле не роняет прогон: результат уже
 * получен, причина уходит проверяющему в metadata и в журнал прогона.
 */
export async function persistRunAttachments(
  supabase: SupabaseClient,
  opts: { workspaceId: string; taskId: string; executionId: string; raw: unknown },
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
