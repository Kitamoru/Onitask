// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
// supabase/functions/agent-runtime/index.ts
// Stage 15: хостед-рантайм внешних агентов (вариант A — Onitask-as-Runtime).
//
// Зачем функция: для коннекторов (endpoint + key) работать должен сервер, а не
// клиент. Функция ведёт ровно тот же цикл, что внешний MCP/CLI-рантайм:
//
//   ops_lease → контекст задачи → вызов агента → ops_terminal → ops_ack
//
// То есть инварианты сохраняются: агент не двигает задачу сам (INV-04), CAS по
// version (INV-09), fencing по execution_id + runtime_id, ретраи через ops_nack.
//
// Вызовы: push-триггер на dispatch_outbox (mode=dispatch, мгновенно) и cron
// `agent-runtime-sweep` раз в 30 секунд (mode=sweep — потерянные push и
// «осиротевшие» прогоны). Auth: только service_role (проверка Bearer,
// timing-safe) — ops_* RPC и доступ к Vault открыты исключительно этой роли.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runAgent, type RunRequest } from './provider.ts';
import {
  base64ToBytes,
  EXTENSION_MIME,
  extensionOf,
  reviewAttachments,
  type RuntimeAttachmentMeta,
} from './attachments.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Потолок одного прогона внутри вызова функции. Платформенный лимит Edge
 * Function — 150 с (free) / 400 с (paid), поэтому держим свой таймаут ниже:
 * обрыв соединения у провайдера без session_id = потеря результата.
 */
const MAX_RUN_TIMEOUT_MS = 120_000;
const MIN_RUN_TIMEOUT_MS = 30_000;
/** Комментариев в контекст — не раздуваем промпт. */
const CONTEXT_COMMENTS_LIMIT = 10;

interface PendingJob {
  outbox_id: string;
  workspace_id: string;
  agent_name: string;
  task_id: string;
  connector_id: string;
  autonomy: string;
  kind: string;
  model: string | null;
  base_url: string;
  limits: Record<string, unknown> | null;
  mcp_allowlist: unknown;
  skills: unknown;
}

interface DueRun {
  run_id: string;
  connector_id: string;
  workspace_id: string;
  execution_id: string;
  task_id: string;
  runtime_id: string;
  status: string;
  agent_name: string;
  model: string | null;
  base_url: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Сравнение секретов без утечки длины/префикса (INV-06/A-2). */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function runTimeoutMs(limits: Record<string, unknown> | null): number {
  const raw = limits && typeof limits.max_run_seconds === 'number' ? limits.max_run_seconds : 900;
  const seconds = Math.max(MIN_RUN_TIMEOUT_MS / 1000, Math.min(raw, MAX_RUN_TIMEOUT_MS / 1000));
  return Math.round(seconds * 1000);
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Авторизация вызова: выделенный секрет рантайма (`get_agent_runtime_secret`,
 * тот же, что подставляют push-триггер и cron) либо service_role ключ функции
 * (ручные вызовы/отладка). Оба сравниваются timing-safe (INV-06).
 *
 * Почему не service_role_key из Vault: он может быть не синхронизирован с env
 * функции — smoke-тест поймал 401 именно на этом (миграция 091).
 */
async function isAuthorized(supabase: SupabaseClient, provided: string): Promise<boolean> {
  const envKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (envKey && timingSafeEqual(provided, `Bearer ${envKey}`)) return true;

  const { data } = await supabase.rpc('get_agent_runtime_secret');
  const secret = typeof data === 'string' ? data : '';
  return Boolean(secret) && timingSafeEqual(provided, `Bearer ${secret}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabase = serviceClient();
  const provided = req.headers.get('Authorization') ?? '';
  if (!(await isAuthorized(supabase, provided))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode === 'dispatch' ? 'dispatch' : 'sweep';

  const results: Record<string, unknown>[] = [];

  // 1. Осиротевшие/недобранные прогоны (resumable): если вызов упал на середине,
  //    строка осталась в submitted/running — её добирает sweeper.
  const { data: dueRaw } = await supabase.rpc('agent_runs_due', { p_limit: 10 });
  for (const run of (dueRaw as DueRun[] | null) ?? []) {
    results.push(await handleDueRun(supabase, run));
  }

  // 2. Новая работа: pending в outbox у агентов с активным коннектором.
  const { data: pendingRaw } = await supabase.rpc('agent_runtime_pending', { p_limit: 5 });
  for (const job of (pendingRaw as PendingJob[] | null) ?? []) {
    results.push(await handleJob(supabase, job));
  }

  return json({ ok: true, mode, processed: results.length, results });
});

// ============================================================================
// Прогон одной задачи по коннектору
// ============================================================================

interface LeaseJob {
  execution_id: string;
  task_id: string;
  receipt: string;
  lease_expires_at?: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  column: string;
  priority: string | null;
  deadline: string | null;
  is_blocked: boolean;
  metadata: Record<string, unknown> | null;
  task_number: number | null;
  version: number;
}

async function logEvent(
  supabase: SupabaseClient,
  job: { workspace_id: string; task_id: string; agent_name: string },
  tool: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await supabase.from('agent_events').insert({
    workspace_id: job.workspace_id,
    task_id: job.task_id,
    agent_name: job.agent_name,
    tool,
    metadata,
  });
}

/**
 * Диагноз провала для nack_detail. Класс ошибки + то, что реально ответил
 * агент: без превью «Агент вернул не JSON-контракт» не диагностируется, а
 * после 3 попыток корень теряется совсем (metadata.nack_detail).
 */
function failureDetail(failure: {
  code: string;
  message: string;
  observedKeys?: string[];
  rawPreview?: string;
}): string {
  const parts = [`${failure.code}: ${failure.message}`];
  if (failure.observedKeys?.length) parts.push(`keys: ${failure.observedKeys.join(', ')}`);
  if (failure.rawPreview) parts.push(`raw: ${failure.rawPreview}`);
  return parts.join(' | ').slice(0, 400);
}

// ============================================================================
// Файлы агента (FILE-01/08): base64 из JSON → Storage + манифест
// ============================================================================

interface AttachmentIngest {
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
async function persistRunAttachments(
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
  }

  return { manifest, rejected: review.rejected, failed };
}

async function handleJob(
  supabase: SupabaseClient,
  job: PendingJob,
): Promise<Record<string, unknown>> {
  const runtimeId = crypto.randomUUID();
  const timeoutMs = runTimeoutMs(job.limits);

  // 1. Lease: владение попыткой. Фенсинг и CAS обеспечивает БД (062).
  const { data: leaseData, error: leaseError } = await supabase.rpc('ops_lease', {
    p_workspace_id: job.workspace_id,
    p_agent_name: job.agent_name,
    p_runtime_id: runtimeId,
    p_limit: 1,
  });

  if (leaseError) {
    await logEvent(supabase, job, 'agent_run_failed', {
      stage: 'lease',
      error: leaseError.message,
    });
    return { outbox_id: job.outbox_id, status: 'lease_error', error: leaseError.message };
  }

  const lease = leaseData as Record<string, unknown> | null;
  if (lease && typeof lease === 'object' && 'error' in lease) {
    const code = (lease.error as Record<string, unknown> | null)?.code ?? 'error';
    return { outbox_id: job.outbox_id, status: 'lease_rejected', error: code };
  }

  const leaseJob = ((lease?.job ?? null) as LeaseJob | null) ?? null;
  if (!leaseJob) {
    // Работу уже забрали (или задача под человеческим изменением) — не ошибка.
    return { outbox_id: job.outbox_id, status: 'no_job' };
  }

  // 2. Снимок задачи на момент прогона.
  const { data: taskRaw } = await supabase
    .from('tasks')
    .select('id, title, description, "column", priority, deadline, is_blocked, metadata, version, task_number')
    .eq('id', leaseJob.task_id)
    .maybeSingle();

  const task = (taskRaw as TaskRow | null) ?? null;
  if (!task) {
    await supabase.rpc('ops_nack', {
      p_execution_id: leaseJob.execution_id,
      p_runtime_id: runtimeId,
      p_receipt: leaseJob.receipt,
      p_reason: 'dependency_unavailable',
      p_detail: 'task not found',
    });
    return { outbox_id: job.outbox_id, status: 'task_missing' };
  }

  // 3. Строка прогона: идемпотентность по execution_id + resumable-сторож.
  const { data: runRow, error: runError } = await supabase
    .from('agent_runs')
    .insert({
      connector_id: job.connector_id,
      workspace_id: job.workspace_id,
      execution_id: leaseJob.execution_id,
      task_id: task.id,
      runtime_id: runtimeId,
      status: 'running',
      // Если вызов умрёт — sweeper увидит строку после этого срока и закроет её.
      next_poll_at: new Date(Date.now() + timeoutMs + 60_000).toISOString(),
      request_digest: {
        model: job.model,
        autonomy: job.autonomy,
        kind: job.kind,
        timeout_ms: timeoutMs,
      },
    })
    .select('id')
    .single();

  if (runError || !runRow) {
    return {
      outbox_id: job.outbox_id,
      status: 'run_exists',
      error: runError?.message ?? 'insert failed',
    };
  }

  const runId = String((runRow as Record<string, unknown>).id);

  // 4. Ключ агента — из Vault, в логи не попадает никогда (INV-19).
  const { data: secret } = await supabase.rpc('agent_connector_get_secret', {
    p_connector_id: job.connector_id,
  });
  const apiKey = typeof secret === 'string' && secret ? secret : null;

  if (!apiKey) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        error_code: 'missing_secret',
        error_text: 'Ключ агента отсутствует в Vault — переподключите агента.',
        finished_at: new Date().toISOString(),
        next_poll_at: null,
      })
      .eq('id', runId);

    await supabase.rpc('ops_nack', {
      p_execution_id: leaseJob.execution_id,
      p_runtime_id: runtimeId,
      p_receipt: leaseJob.receipt,
      p_reason: 'unsupported_task',
      p_detail: 'agent secret is missing',
    });

    await logEvent(supabase, job, 'agent_run_failed', { stage: 'secret', code: 'missing_secret' });
    return { outbox_id: job.outbox_id, status: 'missing_secret' };
  }

  // 5. Контекст: комментарии и граф связей (данные, а не инструкции — provider.ts).
  const [{ data: commentsRaw }, { data: subgraphRaw }, { data: workspaceRaw }] = await Promise.all([
    supabase
      .from('task_comments')
      .select('body, created_at, author_type, author_name')
      .eq('task_id', task.id)
      .order('created_at', { ascending: false })
      .limit(CONTEXT_COMMENTS_LIMIT),
    supabase.rpc('get_task_subgraph', { p_task_id: task.id, p_workspace_id: job.workspace_id }),
    supabase.from('workspaces').select('name, task_prefix').eq('id', job.workspace_id).maybeSingle(),
  ]);

  const workspaceRow = workspaceRaw as Record<string, unknown> | null;
  const prefix = typeof workspaceRow?.task_prefix === 'string' ? workspaceRow.task_prefix : null;
  const fullId =
    prefix && typeof task.task_number === 'number' ? `${prefix}-${task.task_number}` : null;

  const comments = ((commentsRaw as Record<string, unknown>[] | null) ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      author: String(row.author_name ?? (row.author_type === 'agent' ? 'агент' : 'участник')),
      body: String(row.body ?? ''),
      created_at: String(row.created_at ?? ''),
    }));

  const request: RunRequest = {
    baseUrl: job.base_url,
    apiKey,
    model: job.model,
    skills: toArray(job.skills),
    autonomy: job.autonomy,
    workspaceName: typeof workspaceRow?.name === 'string' ? workspaceRow.name : null,
    task: {
      full_id: fullId,
      title: task.title,
      description: task.description,
      column: task.column,
      priority: task.priority,
      deadline: task.deadline,
      is_blocked: task.is_blocked,
      metadata: task.metadata ?? {},
    },
    comments,
    subgraph: toArray(subgraphRaw) as Record<string, unknown>[],
  };

  await logEvent(supabase, job, 'agent_run_submitted', { run_id: runId, model: job.model });

  // 6. Прогон у агента (синхронный, с нашим таймаутом).
  const outcome = await runAgent(request, { timeoutMs });

  if (outcome.ok) {
    // 7a. Успех: единый терминал контура (INV-04) + receipt.
    // Файлы агента — ДО терминала: манифест уходит в metadata прогона (как в
    // MCP-пути opsTerminalCore), bot-notify отправит их вместе с карточкой.
    const files = await persistRunAttachments(supabase, {
      workspaceId: job.workspace_id,
      taskId: task.id,
      executionId: leaseJob.execution_id,
      raw: outcome.result.attachments,
    });

    if (files.rejected.length > 0 || files.failed.length > 0) {
      await logEvent(supabase, job, 'agent_attachments_dropped', {
        run_id: runId,
        rejected: files.rejected,
        failed: files.failed,
      });
    }

    const { data: terminalData, error: terminalError } = await supabase.rpc('ops_terminal', {
      p_execution_id: leaseJob.execution_id,
      p_runtime_id: runtimeId,
      p_task_id: task.id,
      p_task_version: task.version,
      p_outcome: outcome.result.outcome,
      p_summary: outcome.result.summary,
      p_metadata: {
        ...outcome.result.metadata,
        ...(outcome.result.details
          ? { details: outcome.result.details }
          : {}),
        source: 'hosted_connector',
        run_id: runId,
        model: outcome.usage.model ?? job.model,
        usage: outcome.usage,
        ...(files.manifest.length > 0 ? { attachments: files.manifest } : {}),
        ...(files.rejected.length > 0 ? { attachments_rejected: files.rejected } : {}),
        ...(files.failed.length > 0 ? { attachments_failed: files.failed } : {}),
      },
      p_next_owner: outcome.result.nextOwner,
    });

    const terminalCode =
      ((terminalData as Record<string, unknown> | null)?.error as Record<string, unknown> | null)
        ?.code ?? null;

    if (terminalError || terminalCode) {
      const code = String(terminalCode ?? 'terminal_error');
      await supabase
        .from('agent_runs')
        .update({
          status: 'failed',
          error_code: code,
          error_text: terminalError?.message ?? 'ops_terminal rejected the result',
          usage: outcome.usage,
          finished_at: new Date().toISOString(),
          next_poll_at: null,
        })
        .eq('id', runId);
      await logEvent(supabase, job, 'agent_run_failed', { stage: 'terminal', code });
      return { outbox_id: job.outbox_id, status: 'terminal_rejected', error: code };
    }

    // ACK — вторая фаза доставки (терминал уже зафиксирован, поэтому best-effort).
    await supabase.rpc('ops_ack', {
      p_execution_id: leaseJob.execution_id,
      p_runtime_id: runtimeId,
      p_receipt: leaseJob.receipt,
    });

    await supabase
      .from('agent_runs')
      .update({
        status: 'collected',
        provider_run_id: outcome.providerRunId,
        usage: outcome.usage,
        response_digest: {
          outcome: outcome.result.outcome,
          summary_length: outcome.result.summary.length,
          details_length: outcome.result.details?.length ?? 0,
          raw_length: outcome.rawLength,
          next_owner: outcome.result.nextOwner,
          // Мягкий разбор конверта не должен быть молчаливым (provider.ts).
          coerced: outcome.result.coerced,
          attachments: files.manifest.length,
        },
        finished_at: new Date().toISOString(),
        next_poll_at: null,
      })
      .eq('id', runId);

    await logEvent(supabase, job, 'agent_run_collected', {
      run_id: runId,
      outcome: outcome.result.outcome,
    });

    return { outbox_id: job.outbox_id, status: 'collected', outcome: outcome.result.outcome };
  }

  // 7b. Провал. unauthorized — ошибка конфигурации (жжёт попытки впустую) →
  // unsupported_task (эскалация человеку). Остальное — transient_error (requeue).
  const nackReason = outcome.code === 'unauthorized' ? 'unsupported_task' : 'transient_error';
  // Корень провала (класс + превью ответа) — в nack_detail: он доезжает до
  // task.metadata и карточки эскалации, иначе после 3 попыток остаётся
  // безликое «max_attempts».
  const nackDetail = failureDetail(outcome);

  await supabase.rpc('ops_nack', {
    p_execution_id: leaseJob.execution_id,
    p_runtime_id: runtimeId,
    p_receipt: leaseJob.receipt,
    p_reason: nackReason,
    p_detail: nackDetail,
  });

  await supabase
    .from('agent_runs')
    .update({
      status: 'failed',
      error_code: outcome.code,
      error_text: outcome.message.slice(0, 500),
      usage: outcome.usage ?? null,
      // Что именно ответил агент: response_digest вместо null — иначе диагноз
      // провала упирается в «Агент вернул не JSON-контракт» без деталей.
      response_digest: {
        error_code: outcome.code,
        status: outcome.status ?? null,
        raw_preview: outcome.rawPreview ?? null,
        observed_keys: outcome.observedKeys ?? null,
      },
      finished_at: new Date().toISOString(),
      next_poll_at: null,
    })
    .eq('id', runId);

  await logEvent(supabase, job, 'agent_run_failed', {
    run_id: runId,
    code: outcome.code,
    nack: nackReason,
    detail: nackDetail,
  });

  return { outbox_id: job.outbox_id, status: 'failed', error: outcome.code };
}

// ============================================================================
// Осиротевший прогон: вызов функции умер между lease и terminal
// ============================================================================

async function handleDueRun(
  supabase: SupabaseClient,
  run: DueRun,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  // Execution мог закрыться сам (человек подвинул задачу / репер / успешный
  // terminal перед падением) — вмешиваться нельзя, только закрыть журнал.
  const { data: execRaw } = await supabase
    .from('task_executions')
    .select('status, terminal_outcome')
    .eq('id', run.execution_id)
    .maybeSingle();

  const exec = execRaw as Record<string, unknown> | null;

  if (exec && exec.status !== 'open') {
    await supabase
      .from('agent_runs')
      .update({
        status: 'collected',
        error_code: 'run_orphaned_execution_closed',
        error_text: `execution ${String(exec.status)}; результат не собран`,
        finished_at: now,
        next_poll_at: null,
      })
      .eq('id', run.run_id);

    return { run_id: run.run_id, status: 'orphan_execution_closed' };
  }

  // Нужен настоящий receipt из dispatch_receipts — синтетический RPC не примет.
  const { data: receiptRaw } = await supabase
    .from('dispatch_receipts')
    .select('receipt')
    .eq('execution_id', run.execution_id)
    .maybeSingle();

  const receipt = (receiptRaw as Record<string, unknown> | null)?.receipt;

  if (typeof receipt === 'string') {
    // nack вернёт задачу в outbox (или эскалирует на max_attempts) — fail-loud.
    await supabase.rpc('ops_nack', {
      p_execution_id: run.execution_id,
      p_runtime_id: run.runtime_id,
      p_receipt: receipt,
      p_reason: 'transient_error',
      p_detail: 'agent runtime invocation ended before terminal',
    });
  }

  await supabase
    .from('agent_runs')
    .update({
      status: 'failed',
      error_code: 'run_orphaned',
      error_text: 'Вызов рантайма завершился без результата — задача возвращена в очередь.',
      finished_at: now,
      next_poll_at: null,
    })
    .eq('id', run.run_id);

  await logEvent(
    supabase,
    { workspace_id: run.workspace_id, task_id: run.task_id, agent_name: run.agent_name },
    'agent_run_failed',
    { run_id: run.run_id, code: 'run_orphaned' },
  );

  return { run_id: run.run_id, status: 'orphan_nacked' };
}

