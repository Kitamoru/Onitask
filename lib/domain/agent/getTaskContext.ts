// lib/domain/agent/getTaskContext.ts
// MCP Contract v0.8.0 §4.7. Read-only — no quota.
// Full task context: task + column_history + agent_events (last 20 DESC) +
// memory_summary + workspace_context + relevant_docs (graceful null) + subgraph.

import {
  getSupabaseClient,
  getAgentEventsForTask,
  getTaskColumnHistory,
  getTaskSubgraph,
} from '../../shared/mcpAuth';
import { createAttachmentSignedUrl } from '../../shared/attachments';
import { taskNotFound, internalError } from '../../shared/errors';
import type {
  GetTaskContextParams,
  GetTaskContextResult,
  DomainResult,
} from '../../shared/types';

/**
 * Релевантные фрагменты документов доски для агента (Doc RAG).
 *
 * Модель `e5-large` и префикс `query:` — те же, что в F-03. Сторона здесь именно
 * запрос: вектор задачи в tasks.embedding сохранён с `passage:`. Смешивать нельзя.
 *
 * Любая ошибка деградирует в null: контекст агента не должен падать из-за
 * справочного блока (A-6).
 */
async function getRelevantDocs(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string,
  task: { title: string; description?: string | null },
): Promise<GetTaskContextResult['relevant_docs']> {
  try {
    const { data: settings } = await supabase
      .from('workspace_settings')
      .select('data_sharing_level, doc_kb_config')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const docKbEnabled = (settings as any)?.doc_kb_config?.enabled === true;
    const sharingLevel = (settings as any)?.data_sharing_level ?? 'standard';
    if (!docKbEnabled || sharingLevel === 'minimal') return null;

    const apiKey = process.env.NEURALDEEP_KEY || '';
    if (!apiKey) return null;

    const queryText = `${task.title} ${task.description ?? ''}`.trim();
    if (!queryText) return null;

    const res = await fetch('https://api.neuraldeep.ru/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'e5-large', input: `query: ${queryText}` }),
    });
    if (!res.ok) return null;

    const embedding = (await res.json())?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) return null;

    const isFullLevel = sharingLevel === 'full';
    const { data: chunks, error } = await supabase.rpc('match_doc_chunks', {
      query_embedding: embedding,
      match_count: isFullLevel ? 10 : 3,
      min_similarity: isFullLevel ? 0 : 0.68,
      p_workspace_id: workspaceId,
    });
    if (error || !chunks || chunks.length === 0) return null;

    return chunks.map((c: any) => ({
      filename: c.filename ?? '',
      section: c.meta_headers?.h2 ?? c.meta_headers?.h1 ?? '',
      content: c.content ?? '',
      similarity: typeof c.similarity === 'number' ? c.similarity : 0,
    }));
  } catch {
    return null; // graceful degradation
  }
}

export async function getTaskContext(
  params: GetTaskContextParams
): Promise<DomainResult<GetTaskContextResult>> {
  const { key } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  // CTX-02 payload-hygiene flags: defaults preserve legacy behavior; callers
  // opt out of static/heavy sections to keep duty-session context small.
  const includeWorkspaceContext =
    params.include_workspace_context !== false;
  const includeMemorySummary = params.include_memory_summary !== false;
  // FILE-06: вложения задачи (метаданные + signed URL) — default false
  // (payload-hygiene; агент запрашивает явно, когда нужны файлы)
  const includeAttachments = params.include_attachments === true;
  const eventsLimit = Math.min(
    Math.max(params.events_limit ?? 20, 0),
    20
  );

  if (!params.task_id) throw internalError('task_id is required.');

  // --- Task -------------------------------------------------------------------
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id)
    .maybeSingle();

  if (taskError || !task) throw taskNotFound();

  // --- Column history ------------------------------------------------------------
  const columnHistory = await getTaskColumnHistory(workspaceId, params.task_id);

  // --- Agent events (last N=events_limit, DESC) ---------------------------------
  const agentEvents = (
    await getAgentEventsForTask(workspaceId, params.task_id)
  ).slice(0, eventsLimit);

  // --- Memory summary (latest consolidated memory for this agent) ---------------------
  let memorySummary: string | null = null;
  if (includeMemorySummary) {
    try {
      const { data: worker } = await supabase
        .from('workers')
        .select('id')
        // Agent workers use prefixed source_id per Master Spec §6.2 ('agent::<name>')
        .eq('source_id', `agent::${params.agentName}`)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (worker) {
        const { data: mem } = await supabase
          .from('agent_memory')
          .select('summary')
          .eq('worker_id', worker.id as string)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        memorySummary = (mem?.summary as string | null) ?? null;
      }
    } catch {
      memorySummary = null; // graceful degradation
    }
  }

  // --- Workspace context (A-12 / INV-14: read-only, никогда не пишется системой) ---
  let workspaceContext: string | null = null;
  if (includeWorkspaceContext) {
    try {
      const { data: settings } = await supabase
        .from('workspace_settings')
        .select('workspace_context')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      workspaceContext = (settings?.workspace_context as string | null) ?? null;
    } catch {
      workspaceContext = null;
    }
  }

  // --- Relevant docs (Doc RAG) ------------------------------------------------------------
  // Долго стоял заглушкой `const relevantDocs = null`, то есть агент физически не
  // видел документы доски, хотя RPC match_doc_chunks и таблица чанков готовы.
  // Гейты те же, что в F-03 (INV-15): KB выключен → не идём; data_sharing_level
  // 'minimal' → контент документов наружу не уходит.
  const relevantDocs = await getRelevantDocs(supabase, workspaceId, task);

  // --- Subgraph (A-12) --------------------------------------------------------------------
  const subgraph = await getTaskSubgraph(workspaceId, params.task_id);

  // --- Attachments (FILE-06): только если агент явно запросил ---------------
  let attachments: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    url: string | null;
    created_at: string;
  }> | null = null;
  if (includeAttachments) {
    try {
      const { data: rows } = await supabase
        .from('task_attachments')
        .select('id, filename, mime_type, size_bytes, storage_path, created_at')
        .eq('task_id', params.task_id)
        .order('created_at', { ascending: true })
        .limit(10);
      attachments = [];
      for (const row of rows ?? []) {
        const url = await createAttachmentSignedUrl(
          supabase,
          row.storage_path as string,
          3600
        );
        attachments.push({
          id: row.id as string,
          filename: row.filename as string,
          mime_type: row.mime_type as string,
          size_bytes: row.size_bytes as number,
          url,
          created_at: row.created_at as string,
        });
      }
    } catch {
      attachments = null; // graceful degradation
    }
  }

  return {
    success: true,
    task: {
      id: task.id as string,
      full_id: (task.full_id as string) ?? '',
      task_number: (task.task_number as number) ?? 0,
      title: task.title as string,
      description: (task.description as string | null) ?? null,
      column: task.column as string,
      priority: (task.priority as string | null) ?? null,
      assigned_to: (task.assigned_to as string | null) ?? null,
      reviewer_id: (task.reviewer_id as string | null) ?? null,
      is_blocked: task.is_blocked as boolean,
      is_inbox: task.is_inbox as boolean,
      needs_human: task.needs_human as boolean,
      escalation_reason: (task.escalation_reason as string | null) ?? null,
      deadline: (task.deadline as string | null) ?? null,
      version: task.version as number,
      metadata: (task.metadata as Record<string, unknown>) ?? {},
      moved_to_column_at: (task.moved_to_column_at as string | null) ?? null,
    },
    column_history: columnHistory,
    agent_events: agentEvents,
    memory_summary: memorySummary,
    workspace_context: workspaceContext,
    relevant_docs: relevantDocs,
    attachments,
    subgraph:
      (subgraph as GetTaskContextResult['subgraph']) ?? null,
  };
}