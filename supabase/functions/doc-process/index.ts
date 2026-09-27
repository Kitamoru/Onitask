/**
 * Supabase Edge Function: doc_process
 *
 * v28 — e5-large (единая модель эмбеддингов), обрезка сделана явной
 *
 * МОДЕЛЬ ЭМБЕДДИНГОВ (2026-09-27, решение владельца):
 *   Индексация и поиск по ВСЕМ корпусам идут через `e5-large`.
 *   Выбор сделан после сравнения с `bge-m3`: e5-large давал лучшие и более
 *   стабильные результаты на наших данных. ВАЖНО: модель требует асимметричные
 *   префиксы — `passage: ` при индексации, `query: ` при поиске. Смешивать
 *   модели в одном корпусе нельзя: косинус между векторами разных моделей
 *   бессмыслен, и ошибка молчаливая — RPC отработает и вернёт шум.
 *   Не «унифицировать» обратно на bge-m3 без нового замера качества.
 *
 * - CHUNK_SIZE = 900, CHUNK_OVERLAP = 180, MAX_CHUNKS_PER_DOC = 55
 * - EMBEDDING_BATCH_SIZE = 10
 * - Границы: абзац → строка → предложение → ;/: → пробел
 * - Hard-cut посреди слова практически исключён
 * - Обрезка по размеру НЕ молчаливая: документ сверх лимита уходит в
 *   status='failed', а не индексируется частично. v27 резал на 70k символов
 *   и писал в БД chunk_count покрытия, о котором пользователь не знал.
 */
// @ts-nocheck
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────
interface EnrichmentJob {
  id: string;
  workspace_id: string;
  payload: {
    document_id: string;
    filename: string;
    file_type: string;
    storage_path: string;
  };
}

interface DocumentRecord {
  id: string;
  workspace_id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  checksum: string | null;
}

interface ChunkRow {
  document_id: string;
  workspace_id: string;
  chunk_index: number;
  content: string;
  meta_headers: Record<string, unknown>;
  embedding: number[];
}

// ─────────────────────────────────────────────────────────────
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 180;
const MAX_CHUNKS_PER_DOC = 55;
const MINIMUM_CHUNK_LENGTH = 40;
const MAX_JOBS_PER_RUN = 10;
const MAX_FILE_SIZE_BYTES = 100_000;
const MAX_FILE_SIZE_CHARS = 70_000;

const SOFT_TIMEOUT_MS = 120_000;
const EMBEDDING_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const EMBEDDING_BATCH_SIZE = 10;          // ← подняли до 10
const EMBEDDING_RATE_LIMIT_DELAY_MS = 400;

const STALE_PROCESSING_MS = 5 * 60 * 1000;
const INSERT_RETRY_DELAY_MS = 500;
const INSERT_MAX_ATTEMPTS = 3;
const EXPECTED_EMBEDDING_DIM = 1024;

const ALLOWED_TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/md',
  'text/x-markdown',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
]);

// ─────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Улучшенный чанкер с приоритетом смысловых границ.
 * Порядок:
 * 1. \n\n (абзац)
 * 2. \n   (строка)
 * 3. . ! ? (конец предложения)
 * 4. ; : 
 * 5. любой whitespace (чтобы не резать слово)
 * 6. hard cut — только если вообще нет пробелов в разумном диапазоне
 */
function* iterateChunks(
  text: string,
  size: number,
  overlap: number,
): Generator<string> {
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    let chunkEnd = end;

    if (end < text.length) {
      // Минимальная позиция, ниже которой границу почти не принимаем
      // (чтобы чанки не становились слишком короткими)
      const minPos = start + Math.floor(size * 0.28);

      // 1. Абзац
      const paragraphBreak = text.lastIndexOf('\n\n', end - 1);
      if (paragraphBreak >= minPos) {
        chunkEnd = paragraphBreak;
      } else {
        // 2. Строка
        const lineBreak = text.lastIndexOf('\n', end - 1);
        if (lineBreak >= minPos) {
          chunkEnd = lineBreak;
        } else {
          // 3. Конец предложения (. ! ?)
          let sentenceEnd = -1;
          for (const ch of ['.', '!', '?']) {
            let pos = text.lastIndexOf(ch, end - 1);
            while (pos >= minPos) {
              const next = text[pos + 1];
              // После знака должен быть пробел, перенос или конец
              if (
                next === undefined ||
                next === ' ' ||
                next === '\n' ||
                next === '\r' ||
                next === '\t'
              ) {
                sentenceEnd = Math.max(sentenceEnd, pos + 1);
                break;
              }
              pos = text.lastIndexOf(ch, pos - 1);
            }
          }

          if (sentenceEnd >= minPos) {
            chunkEnd = sentenceEnd;
          } else {
            // 4. ; или :
            let punctEnd = -1;
            for (const ch of [';', ':']) {
              const pos = text.lastIndexOf(ch, end - 1);
              if (pos >= minPos) {
                punctEnd = Math.max(punctEnd, pos + 1);
              }
            }

            if (punctEnd >= minPos) {
              chunkEnd = punctEnd;
            } else {
              // 5. Любой whitespace (самое важное — не резать слово)
              // Ищем с конца максимально близко к end
              let spacePos = -1;
              for (let i = end - 1; i >= minPos; i--) {
                const c = text[i];
                if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
                  spacePos = i;
                  break;
                }
              }

              if (spacePos >= minPos) {
                chunkEnd = spacePos;
              } else {
                // 6. Расширенный поиск пробела (даже раньше minPos)
                // Лучше более короткий чанк, чем разрез слова
                for (let i = end - 1; i > start + 20; i--) {
                  const c = text[i];
                  if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
                    chunkEnd = i;
                    break;
                  }
                }
                // Если и тут ничего — оставляем hard cut (крайне редко)
              }
            }
          }
        }
      }
    }

    const chunk = text.slice(start, chunkEnd).trim();
    if (chunk.length >= MINIMUM_CHUNK_LENGTH) {
      yield chunk;
    }

    // Следующая позиция с overlap
    let nextStart = chunkEnd - overlap;
    if (nextStart <= start) {
      nextStart = chunkEnd; // защита от бесконечного цикла
    }
    start = nextStart;

    if (start >= text.length) break;
  }
}

function extractMetaHeaders(chunk: string): Record<string, unknown> {
  const headers: Record<string, unknown> = { source_origin: 'doc_rag' };
  const h1Match = chunk.match(/^#\s+(.+)$/m);
  const h2Match = chunk.match(/^##\s+(.+)$/m);
  if (h1Match) headers.h1 = h1Match[1].trim();
  if (h2Match) headers.h2 = h2Match[1].trim();
  return headers;
}

// ─────────────────────────────────────────────────────────────
async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const inputs = texts.map((t) => `passage: ${t}`);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

      try {
        const res = await fetch('https://api.neuraldeep.ru/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'e5-large',
            input: inputs,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const isRetryableStatus = res.status === 429 || res.status >= 500;
          const errorText = await res.text().catch(() => '');
          const err = new Error(
            `NeuralDeep batch embedding failed: ${res.status} ${errorText}`,
          );
          if (isRetryableStatus) {
            (err as any).retryable = true;
            const retryAfterHeader = res.headers.get('retry-after');
            if (retryAfterHeader) {
              const parsed = Number(retryAfterHeader);
              if (!Number.isNaN(parsed)) (err as any).retryAfterMs = parsed * 1000;
            }
          }
          throw err;
        }

        const data = await res.json();
        if (!data?.data || !Array.isArray(data.data) || data.data.length !== texts.length) {
          throw new Error('NeuralDeep batch embedding returned invalid response');
        }

        return data.data.map((item: any) => {
          const emb = item.embedding;
          if (!Array.isArray(emb) || emb.length === 0) {
            throw new Error('NeuralDeep returned empty or non-array embedding');
          }
          return emb as number[];
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isAbortError = err instanceof Error && err.name === 'AbortError';
      const isNetworkError =
        isAbortError ||
        (err instanceof TypeError && err.message.includes('fetch')) ||
        (err instanceof Error && err.message.includes('timed out'));
      const isRetryableStatus = (err as any)?.retryable === true;

      if (!isNetworkError && !isRetryableStatus) throw lastError;
      if (attempt === MAX_RETRIES) throw lastError;

      const explicitDelay = (err as any)?.retryAfterMs as number | undefined;
      let backoffDelay = explicitDelay
        ?? (isAbortError
          ? RETRY_DELAY_MS * Math.pow(2, attempt) + 2000
          : RETRY_DELAY_MS * Math.pow(2, attempt - 1));

      const totalDelay = backoffDelay + backoffDelay * 0.25 * Math.random();
      console.warn(
        `generateEmbeddingsBatch: attempt ${attempt} failed, retrying in ${Math.round(totalDelay)}ms`,
        lastError.message,
      );
      await sleep(totalDelay);
    }
  }

  throw lastError || new Error('generateEmbeddingsBatch: all retries exhausted');
}

// ─────────────────────────────────────────────────────────────
async function insertChunkBatch(
  supabase: ReturnType<typeof createClient>,
  rows: ChunkRow[],
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  if (rows.length === 0) return { ok: true };
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= INSERT_MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.from('workspace_doc_chunks').insert(rows);
    if (!error) return { ok: true };
    lastError = error;
    if (attempt === INSERT_MAX_ATTEMPTS) return { ok: false, error };
    await sleep(INSERT_RETRY_DELAY_MS * attempt);
  }
  return { ok: false, error: lastError };
}

async function deleteAllChunksForDocument(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
): Promise<void> {
  await supabase.from('workspace_doc_chunks').delete().eq('document_id', documentId);
}

async function markJobFailed(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  documentId: string,
): Promise<void> {
  await deleteAllChunksForDocument(supabase, documentId);
  await Promise.allSettled([
    supabase.from('workspace_documents').update({ status: 'failed' }).eq('id', documentId),
    supabase
      .from('enrichment_queue')
      .update({ status: 'failed', processed_at: new Date().toISOString() })
      .eq('id', jobId),
  ]);
}

/**
 * Пересчитывает checksum документа в формате SHA-256, если там лежит устаревший
 * «сумма байт + длина» вида `checksum_604251_7552` (миграция 133).
 *
 * Вызывается сразу после скачивания файла, поэтому байты уже в руках и лишнего
 * запроса в Storage нет. Хеш считается по тем же байтам, что и в Route Handler,
 * поэтому результат совпадёт с тем, который посчитает следующая загрузка того же
 * файла, — только так отсечение дублей по уникальному индексу вообще работает.
 *
 * Перезаписываются ТОЛЬКО заведомо старые значения. Уже корректный SHA-256
 * не трогаем: повторный пересчёт ничего не меняет, а лишняя запись в БД на
 * каждом документе не нужна.
 *
 * Ошибка перезаписи не должна ронять обработку документа. Единственный реальный
 * сценарий отказа — два легаси-документа с одинаковым содержимым: второй
 * нарушит уникальный индекс. Это повод разобраться, а не повод помечать
 * документ `failed` и терять его индекс.
 */
async function backfillLegacyChecksum(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
  fileData: Blob,
  existingChecksum: string | null,
): Promise<void> {
  if (existingChecksum && /^[0-9a-f]{64}$/.test(existingChecksum)) {
    return; // уже SHA-256
  }

  try {
    const buffer = await fileData.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const { error } = await supabase
      .from('workspace_documents')
      .update({ checksum: sha256 })
      .eq('id', documentId);

    if (error) {
      // Чаще всего 23505: два легаси-документа с одинаковым содержимым.
      console.warn(
        `doc_process: doc=${documentId} legacy checksum backfill rejected (${error.code}): ${error.message}`,
      );
      return;
    }

    console.log(
      `doc_process: doc=${documentId} legacy checksum "${existingChecksum}" → SHA-256 ${sha256.slice(0, 12)}…`,
    );
  } catch (err) {
    console.warn(
      `doc_process: doc=${documentId} legacy checksum backfill failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function markJobDone(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  documentId: string,
  chunkCount: number,
): Promise<void> {
  await Promise.allSettled([
    supabase
      .from('workspace_documents')
      .update({ status: 'ready', chunk_count: chunkCount })
      .eq('id', documentId),
    supabase
      .from('enrichment_queue')
      .update({ status: 'done', processed_at: new Date().toISOString() })
      .eq('id', jobId),
  ]);
}

// ─────────────────────────────────────────────────────────────
serve(async (_req: Request) => {
  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SB_URL') || '';
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
    const neuralDeepKey = Deno.env.get('NEURALDEEP_KEY') || '';

    if (!neuralDeepKey || !supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Missing credentials' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('doc_process: run started (e5-large, chunk=900, batch=8)');

    // Reset stale jobs
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    await supabase
      .from('enrichment_queue')
      .update({ status: 'pending', locked_at: null })
      .eq('type', 'doc_process')
      .eq('status', 'processing')
      .lt('locked_at', staleCutoff);

    let totalProcessed = 0;
    let totalDocuments = 0;
    const allErrors: string[] = [];

    while (totalProcessed < MAX_JOBS_PER_RUN) {
      if (Date.now() - startedAt > SOFT_TIMEOUT_MS) {
        console.warn('doc_process: approaching timeout, stopping early');
        break;
      }

      const { data: pendingJob } = await supabase
        .from('enrichment_queue')
        .select('*')
        .eq('type', 'doc_process')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!pendingJob) break;

      // Atomic claim
      const { data: claimed } = await supabase
        .from('enrichment_queue')
        .update({ status: 'processing', locked_at: new Date().toISOString() })
        .eq('id', pendingJob.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

      if (!claimed) continue;

      const job = claimed as EnrichmentJob;
      const { document_id, filename, storage_path } = job.payload;
      const docStartedAt = Date.now();

      if (!storage_path) {
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      console.log(
        `doc_process [${totalProcessed + 1}/${MAX_JOBS_PER_RUN}]: job=${job.id} doc=${document_id} file=${filename}`,
      );

      const { data: doc } = await supabase
        .from('workspace_documents')
        .select('id, workspace_id, filename, file_type, size_bytes, checksum')
        .eq('id', document_id)
        .maybeSingle();

      if (!doc) {
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      const document = doc as DocumentRecord;

      if (document.size_bytes == null || document.size_bytes > MAX_FILE_SIZE_BYTES) {
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      const { data: fileData, error: storageError } = await supabase.storage
        .from('documents')
        .download(storage_path);

      if (storageError || !fileData) {
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      // Самолечение легаси-checksum (миграция 133).
      //
      // `computeChecksum` в Route Handler переведён с «сумма байт + длина»
      // (`checksum_604251_7552`) на SHA-256, но документы, загруженные ДО
      // деплоя, сохранили старый формат. Для них новый уникальный индекс
      // бесполезен: повторная загрузка того же файла посчитает SHA-256, он
      // не совпадёт с легаси-строкой, и дубль пройдёт.
      //
      // Здесь уже скачан исходный файл, поэтому хеш считается бесплатно, по
      // тем же байтам, что хешировал Route Handler, — значения совпадут.
      // Перезаписываем только явно старый формат, чтобы не трогать строки,
      // которые уже в порядке.
      await backfillLegacyChecksum(supabase, document_id, fileData, document.checksum);

      let textContent: string;
      try {
        textContent = await fileData.text();
      } catch {
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      if (!textContent?.trim()) {
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      // Обрезка по символам — явный отказ, а не тихое усечение (B11, 2026-09-27).
      // v27 делал contentToProcess = textContent.slice(0, MAX_FILE_SIZE_CHARS) и
      // рапортовал в UI «Готово» с chunk_count покрытия ~50k символов из 100k.
      // Пользователь не получал сигнала, что документ проиндексирован частично.
      // Теперь документ сверх лимита честно уходит в status='failed' — этот
      // статус UI уже умеет рисовать, новых элементов интерфейса не требуется.
      if (textContent.length > MAX_FILE_SIZE_CHARS) {
        console.error(
          `doc_process: doc=${document_id} rejected: ${textContent.length} chars > MAX_FILE_SIZE_CHARS=${MAX_FILE_SIZE_CHARS}`,
        );
        allErrors.push(`doc_${document_id}: too_large`);
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      const contentToProcess = textContent;
      await deleteAllChunksForDocument(supabase, document_id);

      let insertedCount = 0;
      let chunkIndex = 0;
      let processingFailed = false;

      const iterator = iterateChunks(contentToProcess, CHUNK_SIZE, CHUNK_OVERLAP);
      let batchTexts: string[] = [];
      let batchIndices: number[] = [];

      const flushBatch = async () => {
        if (batchTexts.length === 0) return;

        let embeddings: number[][];
        try {
          embeddings = await generateEmbeddingsBatch(batchTexts, neuralDeepKey);
        } catch (err) {
          console.error(`doc_process: embedding failed`, err);
          allErrors.push(`doc_${document_id}: embedding_failed`);
          processingFailed = true;
          return;
        }

        await sleep(EMBEDDING_RATE_LIMIT_DELAY_MS);

        const rows: ChunkRow[] = batchTexts.map((chunkText, i) => ({
          document_id,
          workspace_id: document.workspace_id,
          chunk_index: batchIndices[i],
          content: chunkText,
          meta_headers: extractMetaHeaders(chunkText),
          embedding: embeddings[i],
        }));

        const insertResult = await insertChunkBatch(supabase, rows);
        if (!insertResult.ok) {
          processingFailed = true;
          return;
        }

        insertedCount += rows.length;
        console.log(
          `doc_process: doc=${document_id} batch ${batchIndices[0]}-${batchIndices.at(-1)} (${rows.length} rows)`,
        );

        batchTexts = [];
        batchIndices = [];
      };

      let truncated = false;
      for (const chunk of iterator) {
        if (Date.now() - startedAt > SOFT_TIMEOUT_MS) {
          processingFailed = true;
          break;
        }
        // Достигли потолка чанков, а итератор ещё выдаёт — значит документ
        // покрыт частично. Молчаливый break давал «Готово» с неполным индексом.
        if (chunkIndex >= MAX_CHUNKS_PER_DOC) {
          truncated = true;
          break;
        }

        batchTexts.push(chunk);
        batchIndices.push(chunkIndex);
        chunkIndex++;

        if (batchTexts.length === EMBEDDING_BATCH_SIZE) {
          await flushBatch();
          if (processingFailed) break;
        }
      }

      if (truncated) {
        console.error(
          `doc_process: doc=${document_id} rejected: exceeds MAX_CHUNKS_PER_DOC=${MAX_CHUNKS_PER_DOC}`,
        );
        allErrors.push(`doc_${document_id}: too_many_chunks`);
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      if (!processingFailed) await flushBatch();

      if (processingFailed) {
        console.error(
          `doc_process: failed doc=${document_id}, inserted=${insertedCount}, elapsed=${Date.now() - docStartedAt}ms`,
        );
        await markJobFailed(supabase, job.id, document_id);
        totalProcessed++;
        continue;
      }

      await markJobDone(supabase, job.id, document_id, insertedCount);
      totalProcessed++;
      totalDocuments++;

      console.log(
        `doc_process: done job=${job.id} chunks=${insertedCount} elapsed=${Date.now() - docStartedAt}ms`,
      );
    }

    // NOTE: блок «Context invalidation» (context_stale + workspace_context_rebuild)
    // удалён 2026-09-27. Обе сущности снесены F03-16 (миграции 114–119): колонки
    // workspace_settings.context_stale больше нет, а тип 'workspace_context_rebuild'
    // вычеркнут из CHECK enrichment_queue_type. Код падал молча — ошибки await не
    // проверялись. Возвращать нечего: оперативный контекст теперь считается
    // детерминированно через get_workspace_operational_context.

    const { count } = await supabase
      .from('enrichment_queue')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'doc_process')
      .eq('status', 'pending');

    return new Response(
      JSON.stringify({
        message: 'Processing complete',
        model: 'e5-large',
        chunk_size: CHUNK_SIZE,
        batch_size: EMBEDDING_BATCH_SIZE,
        jobs_processed: totalProcessed,
        documents_processed: totalDocuments,
        has_more: (count ?? 0) > 0,
        duration_ms: Date.now() - startedAt,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('doc_process: unexpected error', err);
    return new Response(
      JSON.stringify({
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});