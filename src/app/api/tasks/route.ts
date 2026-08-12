'use server';

/**
 * Flow Board API — Tasks endpoint.
 *
 * Implements last-write-wins semantics without version check (per INV-09 note).
 * Supports GET (list) and POST (create) at /api/tasks.
 * PATCH is handled by /api/tasks/[id]/route.ts.
 *
 * Uses Telegram initData auth (server-side, service_role key) instead of Supabase Auth.
 *
 * Based on: dev_setup §7.2, §7.3, TASKS.md Stage 4 FLOW-01
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import { authenticateRequest } from '../../../../lib/api-auth';
import type { Database } from '../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthenticatedProfile(req: NextRequest) {
  // Try body first (POST/PATCH), then header (GET)
  let initData: string | undefined;

  if (req.method === 'GET') {
    initData = req.headers.get('x-init-data') || undefined;
  } else {
    try {
      const body = await req.clone().json();
      initData = body.init_data as string | undefined;
    } catch {
      // Body not parseable
    }
  }

  const auth = await authenticateRequest(initData);
  if (!auth.authenticated) return null;

  const supabase = createServerClient();
  const { data: workers } = await supabase
    .from('workers')
    .select('id, workspace_id, source_id, type')
    .eq('source_id', auth.profileId!)
    .eq('is_active', true)
    .limit(1);

  return workers?.[0] ?? null;
}

/** Cache workspace prefixes by ID for batch queries */
const prefixCache = new Map<string, string>();

async function getPrefix(workspaceId: string): Promise<string | null> {
  if (prefixCache.has(workspaceId)) return prefixCache.get(workspaceId) ?? null;
  const supabase = createServerClient();
  const { data } = await supabase
    .from('workspaces')
    .select('task_prefix')
    .eq('id', workspaceId)
    .single();
  const prefix = (data as any)?.task_prefix ?? null;
  prefixCache.set(workspaceId, prefix);
  return prefix;
}

async function mapTaskRow(row: TasksRow): Promise<{
  id: string;
  full_id: string;
  workspace_prefix: string;
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
}> {
  const prefix = await getPrefix(row.workspace_id);
  const fullId = prefix && row.task_number
    ? `${prefix}-${row.task_number}`
    : row.id.slice(0, 8);

  return {
    id: row.id,
    full_id: fullId,
    workspace_prefix: prefix ?? 'TASK',
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
    reviewer_id: row.reviewer_id,
    handoff_to: row.handoff_to,
    handoff_notes: row.handoff_notes,
    sprint_id: row.sprint_id,
    cognitive_weight: row.cognitive_weight,
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
  };
}

// ─── GET /api/tasks — List tasks ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const worker = await getAuthenticatedProfile(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const { workspace_id } = worker;
    const supabase = createServerClient();

    // Parse query params
    const url = new URL(request.url);
    const column = url.searchParams.get('column');
    const assignedTo = url.searchParams.get('assigned_to');
    const includeInbox = url.searchParams.get('include_inbox') === 'true';

    let query = supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspace_id)
      .order('updated_at', { ascending: false });

    if (column) {
      query = query.eq('column', column);
    }

    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }

    if (!includeInbox) {
      query = query.eq('is_inbox', false);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Handle async mapping properly
    const finalTasks: Awaited<ReturnType<typeof mapTaskRow>>[] = [];
    for (const task of (data ?? []) as TasksRow[]) {
      finalTasks.push(await mapTaskRow(task));
    }

    return NextResponse.json({
      tasks: finalTasks,
      count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── POST /api/tasks — Create task ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const worker = await getAuthenticatedProfile(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, column, priority, cognitive_weight, deadline, is_blocked, needs_human, tags, source } = body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Поле "title" обязательно и должно быть строкой' }, { status: 400 });
    }

    const workspaceId = worker.workspace_id;
    const supabase = createServerClient();

    // Build insert payload with only known columns
    // Note: created_by is temporarily cast until types are regenerated after migration 023
    const insertPayload = {
      workspace_id: workspaceId,
      title: title.trim(),
      description: description ?? null,
      column: column ?? 'backlog',
      priority: priority ?? 'medium',
      cognitive_weight: cognitive_weight ?? 1,
      deadline: deadline ?? null,
      is_blocked: is_blocked ?? false,
      needs_human: needs_human ?? false,
      is_inbox: !column, // auto-set inbox if no explicit column
      tags: tags ?? [],
      source: source ?? 'manual',
      created_by: worker.id,
    } as Database['public']['Tables']['tasks']['Insert'] & { created_by: string };

    const { data, error } = await supabase
      .from('tasks')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task: mapTaskRow(data as TasksRow) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}