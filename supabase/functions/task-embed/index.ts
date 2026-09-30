/**
 * Supabase Edge Function: task-embed
 *
 * Пересчёт эмбеддингов задач (A1, 2026-09-27).
 *
 * ЗАЧЕМ. Триггер `trg_invalidate_task_embedding` обнуляет `tasks.embedding` при
 * ЛЮБОМ изменении title/description. Пересчёт же жил только внутри F-03
 * (`enrich-task`), а тот запускается один раз при создании задачи. Итог:
 * вектор задачи жил ровно до первой правки заголовка, после чего оставался NULL
 * навсегда. Фактически в БД было 2 эмбеддинга на 50 задач.
 *
 * Следствие было не косметическим: `match_tasks` исключает саму задачу
 * (`id != exclude_task_id`), поэтому при одном векторе на воркспейс он физически
 * не мог вернуть строку. Калибровка `story_points` по аналогичным задачам
 * (F03-05) не работала ни разу.
 *
 * ПОЧЕМУ СВИП, А НЕ НОВЫЙ ТИП В `enrichment_queue`:
 *   - очередь потребовала бы ALTER CHECK; `enrichment_queue` — это пайплайн
 *     LLM-обогащения, а тут только векторизация;
 *   - перезапуск F-03 на задаче дорог: полный вызов GPT-OSS-120B ради одного
 *     вектора;
 *   - `embedding IS NULL` — уже готовый маркер «грязный», его выставляет триггер
 *     инвалидации. Отдельная колонка не нужна.
 *
 * МОДЕЛЬ: `e5-large`, префикс `passage:` — вектор ПИШЕТСЯ в tasks.embedding и
 * позже участвует в `match_tasks` как passage. Сторону запроса (`query:`) считает
 * enrich-task. Хеш обязан совпадать с `computeContentHash` в enrich-task, иначе
 * cache-hit перестанет срабатывать.
 *
 * Идемпотентен: перезаписывает только NULL-векторы, повторный прогон по готовым
 * задачам не делает запросов к NeuralDeep.
 */
// @ts-nocheck
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NEURALDEEP_URL = 'https://api.neuraldeep.ru/v1';
const EMBEDDING_MODEL = 'e5-large';
const PASSAGE_PREFIX = 'passage: ';

const BATCH_SIZE = 10;
const MAX_TASKS_PER_RUN = 100;
const EMBEDDING_TIMEOUT_MS = 60_000;
const RATE_LIMIT_DELAY_MS = 400;
const SOFT_TIMEOUT_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Должен совпадать байт-в-байт с computeContentHash() в enrich-task/index.ts,
 * иначе cache-hit в F-03 перестанет срабатывать и задача будет переэмбеживаться
 * на каждом F-03. При изменении — менять в обоих файлах.
 */
async function computeContentHash(title: string, description: string | null): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${title}\0${description ?? ''}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}


/**
 * Батчевый эмбеддинг. `passage:` — сторона документа (запись в tasks.embedding).
 */
async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const res = await fetch(`${NEURALDEEP_URL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts.map((t) => `${PASSAGE_PREFIX}${t}`),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`NeuralDeep batch embedding failed: ${res.status} ${errorText}`);
    }

    const data = await res.json();
    if (!data?.data || !Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new Error('NeuralDeep batch embedding returned invalid response');
    }

    return data.data.map((item: any) => {
      const emb = item?.embedding;
      if (!Array.isArray(emb) || emb.length === 0) {
        throw new Error('NeuralDeep returned empty or non-array embedding');
      }
      return emb as number[];
    });
  } finally {
    clearTimeout(timeoutId);
  }
}


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

    // Только «грязные» задачи — не посчитанные или сброшенные триггером.
    const { data: pending, error: selectError } = await supabase
      .from('tasks')
      .select('id, title, description')
      .is('embedding', null)
      // ADR-2026-09-30: подзадачи не самостоятельные задачи. `match_tasks`
      // исключает только саму задачу (`id != exclude_task_id`), поэтому
      // вектор подзадачи находил бы:
      //   1) сам родитель — обогащение получало бы собственные подзадачи
      //      как «похожие задачи»;
      //   2) чужие подзадачи как дубликаты новой задачи.
      // Свип отфильтровывает их тем же условием, поэтому строка не
      // «залипает» в грязном состоянии и в очередь не попадает.
      // Поиск по подзадачам — отдельная parent-scoped механика (см. ADR).
      .is('parent_task_id', null)
      .order('created_at', { ascending: true })
      .limit(MAX_TASKS_PER_RUN);

    if (selectError) {
      console.error('task_embed: select failed', selectError);
      return new Response(JSON.stringify({ error: 'select_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tasks = pending ?? [];
    if (tasks.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'Nothing to do',
          model: EMBEDDING_MODEL,
          processed: 0,
          failed: 0,
          duration_ms: Date.now() - startedAt,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      if (Date.now() - startedAt > SOFT_TIMEOUT_MS) {
        console.warn('task_embed: soft timeout, stopping early');
        break;
      }

      const batch = tasks.slice(i, i + BATCH_SIZE);

      // Пустой title не векторизуем — иначе в индекс попадёт мусорный вектор.
      const hasTitle = (t: any) => typeof t.title === 'string' && t.title.trim().length > 0;
      const usable = batch.filter(hasTitle);
      for (const skipped of batch.filter((t: any) => !hasTitle(t))) {
        failed++;
        errors.push(`task_${skipped.id}: empty_title`);
      }
      if (usable.length === 0) continue;

      const texts = usable.map((t: any) => `${t.title} ${t.description ?? ''}`.trim());

      let embeddings: number[][];
      try {
        embeddings = await generateEmbeddingsBatch(texts, neuralDeepKey);
      } catch (err) {
        // Батч не удался — задачи остаются NULL и возьмутся в следующем прогоне.
        // Частичная запись дала бы вектор без хеша, и cache-hit в F-03 вёл бы
        // себя непредсказуемо.
        console.error(`task_embed: batch ${i} failed`, err);
        failed += usable.length;
        errors.push(`batch_${i}: ${err instanceof Error ? err.message : 'unknown'}`);
        break;
      }

      await sleep(RATE_LIMIT_DELAY_MS);

      for (let j = 0; j < usable.length; j++) {
        const task = usable[j];
        const { error: updateError } = await supabase
          .from('tasks')
          .update({
            embedding: embeddings[j],
            embedding_hash: await computeContentHash(task.title, task.description),
            embedding_updated_at: new Date().toISOString(),
          })
          .eq('id', task.id);

        if (updateError) {
          failed++;
          errors.push(`task_${task.id}: ${updateError.message}`);
        } else {
          processed++;
        }
      }
    }

    console.log(
      `task_embed: processed=${processed} failed=${failed} elapsed=${Date.now() - startedAt}ms`,
    );

    return new Response(
      JSON.stringify({
        message: 'Sweep complete',
        model: EMBEDDING_MODEL,
        prefix: PASSAGE_PREFIX.trim(),
        candidates: tasks.length,
        processed,
        failed,
        errors: errors.slice(0, 10),
        duration_ms: Date.now() - startedAt,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('task_embed: unexpected error', err);
    return new Response(
      JSON.stringify({
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
