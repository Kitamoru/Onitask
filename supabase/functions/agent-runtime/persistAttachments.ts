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

/** TTL одноразовой ссылки на загрузку. Должно хватать на POST файла агентом. */
const UPLOAD_URL_TTL_SECONDS = 900;

/**
 * FILE-08: одноразовая ссылка на загрузку файла + путь, который агент вернёт.
 *
 * Зачем так, а не base64 в ответе: байты, сгенерированные моделью, упираются
 * в потолок ответа (десятки тысяч токенов — это десятки килобайт файла) и ещё
 * стоят токены за каждый байт. Здесь байты идут обычным POST-ом, мимо модели,
 * поэтому размер ограничен только Storage.
 *
 * Ссылка именно одноразовая и с узким TTL: агент ходит по ней только чтобы
 * отдать файл текущего прогона. Права не нужны — авторизацию несёт сам URL.
 *
 * Ссылка привязана к ОДНОМУ объекту (Storage не умеет подписывать префикс),
 * и путь не имеет расширения: имя и MIME берутся из манифеста
 * (bot-notify отправляет в Telegram по filename из task_attachments).
 * Из-за привязки к одному объекту ссылка годится ровно для одного файла —
 * второй POST по ней перезаписал бы первый молча, поэтому ограничение
 * зафиксировано и в промте, и проверкой дубликатов в манифесте.
 *
 * Ошибка minting'а не должна ронять прогон: возвращаем null, и агент
 * отработает через base64-фолбэк.
 */
export async function mintUploadTarget(
  supabase: SupabaseClient,
  ids: { workspaceId: string; taskId: string; executionId: string },
): Promise<{ storagePath: string; url: string } | null> {
  const storagePath = `${ids.workspaceId}/${ids.taskId}/${ids.executionId}`;
  try {
    const { data, error } = await supabase.storage
      .from('task-attachments')
      .createSignedUploadUrl(storagePath, UPLOAD_URL_TTL_SECONDS);
    if (error || !data?.token) {
      console.error('[agent-runtime] mint upload url failed:', error?.message ?? 'no token');
      return null;
    }
    const projectUrl = Deno.env.get('SUPABASE_URL');
    if (!projectUrl) return null;
    return {
      storagePath,
      url: `${projectUrl}/storage/v1/object/upload/task-attachments/${storagePath}?token=${data.token}`,
    };
  } catch (err) {
    console.error('[agent-runtime] mint upload url threw:', err);
    return null;
  }
}

/**
 * Кладёт файлы агента туда же, куда и MCP-путь (opsTerminalCore): бинарник →
 * Storage 'task-attachments' (приватный), манифест → task_attachments.
 *
 * Два пути доставки байтов (FILE-08): агент залил файл сам по одноразовой
 * ссылке и вернул storage_path — тогда мы только пишем манифест; либо вернул
 * content_base64 — тогда декодируем и грузим сами (фолбэк для мелких файлов).
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
