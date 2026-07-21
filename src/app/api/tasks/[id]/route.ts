'use server';

/**
 * PATCH /api/tasks/[id] — Update a single task (last-write-wins).
 *
 * Implements last-write-wins semantics without version check (per INV-09 note).
 * Supports partial updates: column, assigned_to, reviewer_id, priority,
 * cognitive_weight, deadline, title, description, is_blocked, needs_human, tags.
 *
 * Also broadcasts a 'task_changed' event for flow metrics cache invalidation.
 *
 * Uses Telegram initData auth (server-side, service_role key) instead of Supabase Auth.
 *
 * Based on: dev_setup §7.2, §7.3, TASKS.md Stage 4 FLOW-01
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import type { Database } from '../../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthenticatedWorker(request: NextRequest) {
  let initData: string | undefined;

  try {
    const body = await request.clone().json();
    initData = body.init_data as string | undefined;
  } catch {
    // Body not parseable
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

function mapTaskRow(row: TasksRow) {
  const fullId = row.task_number ? `TASK-${row.task_number}` : row.id.slice(0, 8);

  return {
    id: row.id,
    full_id: fullId,
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
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── PATCH /api/tasks/[id] — Update task ─────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const { id: taskId } = await params;
    const body = await request.json();

    // Build update object with only allowed fields
    const allowedFields = [
      'column', 'assigned_to', 'reviewer_id', 'priority',
      'cognitive_weight', 'deadline', 'title', 'description',
      'is_blocked', 'needs_human', 'tags', 'metadata',
      'handoff_to', 'handoff_notes', 'clarity_score', 'complexity',
      'enrichment_strategy', 'raw_input', 'source',
    ];

    const update: Partial<TasksRow> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        update[field as keyof TasksRow] = body[field];
      }
    }

    // Auto-set moved_to_column_at when column changes
    if ('column' in body && update.moved_to_column_at === undefined) {
      update.moved_to_column_at = new Date().toISOString();
    }

    // Increment version
    const supabase = createServerClient();
    const { data: currentTask } = await supabase
      .from('tasks')
      .select('version')
      .eq('id', taskId)
      .single();

    if (currentTask) {
      update.version = ((currentTask as any).version ?? 0) + 1;
    }

    // Remove undefined values
    const cleanUpdate = Object.fromEntries(
      Object.entries(update).filter(([, v]) => v !== undefined),
    ) as Partial<TasksRow>;

    const { data, error } = await supabase
      .from('tasks')
      .update(cleanUpdate)
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Broadcast task_changed event for flow metrics cache invalidation
    try {
      await supabase
        .channel('flowboard-metrics')
        .send({
          type: 'broadcast',
          event: 'task_changed',
          payload: { workspace_id: worker.workspace_id },
        });
    } catch {
      // Broadcast is best-effort
    }

    return NextResponse.json({ task: mapTaskRow(data as TasksRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}