/**
 * Task enrichment utilities — shared between API routes.
 *
 * Provides functions to enrich raw task rows with:
 * - workspace_name (from workspaces.name)
 * - workspace_prefix (from workspaces.task_prefix)
 * - created_by_name (from workers.display_name WHERE id = created_by)
 * - assigned_to_name (from workers.display_name WHERE id = assigned_to)
 */

import { createServerClient } from './supabase';
import { buildFullId } from './taskFullId';
import type { Database } from '../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

/**
 * SUB-01: номера родителей для сборки «PREFIX-42-SUB-1».
 *
 * Нужен, потому что у подзадачи `task_number = NULL` — номер производный от
 * родителя, и без него обогащение уходило в `id.slice(0,8)`. Один запрос на
 * пачку, симметрично getWorkerNames/getWorkspaceInfos — не N+1.
 */
async function getParentTaskNumbers(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const supabase = createServerClient();
  const { data } = await supabase
    .from('tasks')
    .select('id, task_number')
    .in('id', ids);
  return new Map(
    ((data ?? []) as Array<{ id: string; task_number: number | null }>).map((r) => [
      r.id,
      r.task_number as number,
    ]),
  );
}

// ─── Caches ──────────────────────────────────────────────────────────────────

const workspaceCache = new Map<string, { task_prefix: string; name: string }>();
const workerNameCache = new Map<string, string>();

// ─── Workspace info ──────────────────────────────────────────────────────────

export async function getWorkspaceInfo(workspaceId: string): Promise<{ task_prefix: string; name: string }> {
  if (workspaceCache.has(workspaceId)) return workspaceCache.get(workspaceId)!;

  const supabase = createServerClient();
  const { data } = await supabase
    .from('workspaces')
    .select('task_prefix, name')
    .eq('id', workspaceId)
    .single();

  const info = {
    task_prefix: ((data as any)?.task_prefix as string) ?? 'TASK',
    name: ((data as any)?.name as string) ?? ((data as any)?.task_prefix as string) ?? 'TASK',
  };

  workspaceCache.set(workspaceId, info);
  return info;
}

// ─── Batch workspace info ────────────────────────────────────────────────────

export async function getWorkspaceInfos(workspaceIds: string[]): Promise<Map<string, { task_prefix: string; name: string }>> {
  const results = new Map<string, { task_prefix: string; name: string }>();

  // Filter out already cached
  const missingIds = workspaceIds.filter(id => !workspaceCache.has(id));
  if (missingIds.length === 0) {
    workspaceIds.forEach(id => {
      if (workspaceCache.has(id)) results.set(id, workspaceCache.get(id)!);
    });
    return results;
  }

  const supabase = createServerClient();
  const { data } = await supabase
    .from('workspaces')
    .select('id, task_prefix, name')
    .in('id', missingIds);

  for (const ws of (data as any[]) ?? []) {
    const info = {
      task_prefix: ws.task_prefix ?? 'TASK',
      name: ws.name ?? ws.task_prefix ?? 'TASK',
    };
    workspaceCache.set(ws.id, info);
    results.set(ws.id, info);
  }

  // Fill remaining from cache
  missingIds.forEach(id => {
    if (!results.has(id) && workspaceCache.has(id)) {
      results.set(id, workspaceCache.get(id)!);
    }
  });

  return results;
}

// ─── Worker display name ─────────────────────────────────────────────────────

export async function getWorkerName(workerId: string): Promise<string | null> {
  if (workerNameCache.has(workerId)) return workerNameCache.get(workerId) ?? null;

  const supabase = createServerClient();
  const { data } = await supabase
    .from('workers')
    .select('display_name')
    .eq('id', workerId)
    .single();

  const name = ((data as any)?.display_name as string) ?? null;
  workerNameCache.set(workerId, name);
  return name;
}

// ─── Batch worker names ──────────────────────────────────────────────────────

export async function getWorkerNames(workerIds: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  // Filter out already cached
  const missingIds = workerIds.filter(id => !workerNameCache.has(id));
  if (missingIds.length === 0) {
    workerIds.forEach(id => {
      results.set(id, workerNameCache.get(id) ?? null);
    });
    return results;
  }

  const supabase = createServerClient();
  const { data } = await supabase
    .from('workers')
    .select('id, display_name')
    .in('id', missingIds);

  for (const w of (data as any[]) ?? []) {
    const name = (w.display_name as string) ?? null;
    workerNameCache.set(w.id, name);
    results.set(w.id, name);
  }

  // Fill remaining from cache
  missingIds.forEach(id => {
    if (!results.has(id) && workerNameCache.has(id)) {
      results.set(id, workerNameCache.get(id) ?? null);
    }
  });

  return results;
}

// ─── Enrich a single task row ────────────────────────────────────────────────

export interface EnrichedTask {
  id: string;
  full_id: string;
  workspace_id: string;
  workspace_prefix: string;
  workspace_name: string;
  task_number: number;
  title: string;
  description: string | null;
  tags: string[];
  column: string;
  priority: string;
  deadline: string | null;
  deadline_urgency: string | null;
  is_inbox: boolean;
  is_blocked: boolean;
  needs_human: boolean;
  escalation_reason: string | null;
  assigned_to: string | null;
  assigned_to_name?: string;
  reviewer_id: string | null;
  handoff_to: string | null;
  handoff_notes: string | null;
  sprint_id: string | null;
  cognitive_weight: number;
  raw_input: string | null;
  clarity_score: number | null;
  complexity: number | null;
  enrichment_strategy: string | null;
  version: number;
  moved_to_column_at: string | null;
  position: number;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  created_by_name?: string;
  // SUB-01: без этих полей подзадача теряла связь с родителем по дороге к
  // клиенту — и isSubtask() на ней вернул бы false.
  parent_task_id: string | null;
  subtask_index: number | null;
  // Additional fields that exist on the raw task row but are not used for enrichment
  story_points?: number | null;
  embedding?: any;
  embedding_hash?: any;
  embedding_updated_at?: any;
}

export async function enrichTaskRow(row: TasksRow): Promise<EnrichedTask> {
  const workspaceInfo = await getWorkspaceInfo(row.workspace_id);
  // SUB-01: прежде здесь стояло `prefix && task_number ? ... : id.slice(0,8)`.
  // У подзадачи task_number = NULL, и обогащение отдавало «8a35e04c».
  const parentNumber = row.parent_task_id
    ? ((await getParentTaskNumbers([row.parent_task_id])).get(row.parent_task_id) ?? null)
    : null;
  const fullId = buildFullId(
    workspaceInfo.task_prefix,
    row.task_number,
    row.id,
    row.subtask_index,
    parentNumber,
  );

  // Fetch worker display names in parallel
  const [createdByName, assignedToName] = await Promise.all([
    row.created_by ? getWorkerName(row.created_by) : Promise.resolve(null),
    row.assigned_to ? getWorkerName(row.assigned_to) : Promise.resolve(null),
  ]);

  return {
    id: row.id,
    full_id: fullId,
    workspace_id: row.workspace_id,
    workspace_prefix: workspaceInfo.task_prefix,
    workspace_name: workspaceInfo.name,
    task_number: row.task_number ?? 0,
    title: row.title,
    description: row.description,
    tags: row.tags,
    column: row.column,
    priority: row.priority,
    deadline: row.deadline,
    deadline_urgency: row.deadline_urgency,
    is_inbox: row.is_inbox,
    is_blocked: row.is_blocked,
    needs_human: row.needs_human,
    escalation_reason: row.escalation_reason,
    assigned_to: row.assigned_to,
    assigned_to_name: assignedToName ?? undefined,
    reviewer_id: row.reviewer_id,
    handoff_to: row.handoff_to,
    handoff_notes: row.handoff_notes,
    sprint_id: row.sprint_id,
    cognitive_weight: row.cognitive_weight,
    story_points: (row as TasksRow & { story_points?: number | null }).story_points ?? null,
    raw_input: row.raw_input,
    clarity_score: row.clarity_score,
    complexity: row.complexity,
    enrichment_strategy: row.enrichment_strategy,
    version: row.version,
    moved_to_column_at: row.moved_to_column_at,
    position: row.position,
    source: row.source,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by ?? null,
    created_by_name: createdByName ?? undefined,
    parent_task_id: row.parent_task_id ?? null,
    subtask_index: row.subtask_index ?? null,
  };
}

// ─── Enrich multiple task rows (batch version — single DB query) ─────────────

export async function enrichTaskRowsBatch(rows: TasksRow[]): Promise<EnrichedTask[]> {
  if (rows.length === 0) return [];

  // Collect unique workspace IDs and worker IDs
  const workspaceIds = Array.from(new Set(rows.map(r => r.workspace_id)));
  const workerIds = Array.from(new Set(
    rows
      .flatMap(r => [r.created_by, r.assigned_to].filter(Boolean) as string[])
  ));
  // SUB-01: родители подзадач. Без их номеров full_id собирался бы в hex.
  const parentIds = Array.from(new Set(
    rows.map(r => r.parent_task_id).filter(Boolean) as string[]
  ));

  // Batch fetch all at once
  const [workspaceMap, workerMap, parentNumbers] = await Promise.all([
    getWorkspaceInfos(workspaceIds),
    getWorkerNames(workerIds),
    getParentTaskNumbers(parentIds),
  ]);

  // Build lookup maps for O(1) access
  const wsLookup = new Map<string, { task_prefix: string; name: string }>();
  for (const ws of rows) {
    const info = workspaceMap.get(ws.workspace_id);
    if (info) wsLookup.set(ws.workspace_id, info);
  }

  const createdByNameMap = new Map<string, string | null>();
  const assignedToNameMap = new Map<string, string | null>();
  for (const r of rows) {
    if (r.created_by) createdByNameMap.set(r.created_by, workerMap.get(r.created_by) ?? null);
    if (r.assigned_to) assignedToNameMap.set(r.assigned_to, workerMap.get(r.assigned_to) ?? null);
  }

  // Map rows to enriched tasks
  return rows.map((row) => {
    const workspaceInfo = wsLookup.get(row.workspace_id) ?? { task_prefix: 'TASK', name: 'TASK' };
    // SUB-01: было `prefix && task_number ? ... : id.slice(0,8)` — у подзадачи
    // task_number = NULL, и в шапке шторки показывалось «Подзадача 8a35e04c».
    const fullId = buildFullId(
      workspaceInfo.task_prefix,
      row.task_number,
      row.id,
      row.subtask_index,
      row.parent_task_id ? parentNumbers.get(row.parent_task_id) ?? null : null,
    );

    return {
      id: row.id,
      full_id: fullId,
      workspace_id: row.workspace_id,
      workspace_prefix: workspaceInfo.task_prefix,
      workspace_name: workspaceInfo.name,
      task_number: row.task_number ?? 0,
      title: row.title,
      description: row.description,
      tags: row.tags,
      column: row.column,
      priority: row.priority,
      deadline: row.deadline,
      deadline_urgency: row.deadline_urgency,
      is_inbox: row.is_inbox,
      is_blocked: row.is_blocked,
      needs_human: row.needs_human,
      escalation_reason: row.escalation_reason,
      assigned_to: row.assigned_to,
      assigned_to_name: assignedToNameMap.get(row.assigned_to ?? '') ?? undefined,
      reviewer_id: row.reviewer_id,
      handoff_to: row.handoff_to,
      handoff_notes: row.handoff_notes,
      sprint_id: row.sprint_id,
      cognitive_weight: row.cognitive_weight,
      story_points: (row as TasksRow & { story_points?: number | null }).story_points ?? null,
      raw_input: row.raw_input,
      clarity_score: row.clarity_score,
      complexity: row.complexity,
      enrichment_strategy: row.enrichment_strategy,
      version: row.version,
      moved_to_column_at: row.moved_to_column_at,
      position: row.position,
      source: row.source,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by ?? null,
      parent_task_id: row.parent_task_id ?? null,
      subtask_index: row.subtask_index ?? null,
      created_by_name: createdByNameMap.get(row.created_by ?? '') ?? undefined,
    };
  });
}

// ─── Enrich multiple task rows (sequential — kept for backward compat) ────────

export async function enrichTaskRows(rows: TasksRow[]): Promise<EnrichedTask[]> {
  const results: EnrichedTask[] = [];
  for (const row of rows) {
    results.push(await enrichTaskRow(row));
  }
  return results;
}