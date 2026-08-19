'use server';

/**
 * PATCH /api/tasks/[id] — Update a single task (last-write-wins).
 *
 * Implements last-write-wins semantics (per INV-09). When the client sends an
 * `expected_version`, the server compares it against the current DB version and
 * returns a `warning` on mismatch so the client can reconcile via force refresh.
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
import { enrichTaskRow } from '../../../../../lib/taskEnrichment';
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
    // Only include fields that are defined and not null to avoid DB NOT NULL violations
    if (body[field] != null) { // catches undefined and null
      update[field as keyof TasksRow] = body[field];
    }
  }

    // Auto-set moved_to_column_at when column changes
    if ('column' in body && update.moved_to_column_at === undefined) {
      update.moved_to_column_at = new Date().toISOString();
    }

    // Increment version atomically (INV-09).
    const supabase = createServerClient();
    const { data: currentTask } = await supabase
      .from('tasks')
      .select('version')
      .eq('id', taskId)
      .single();

    // Optimistic concurrency: if the client sent expected_version and it doesn't
    // match the current DB version, another client changed the task concurrently.
    // Apply last-write-wins (backward compatible) but surface a warning so the
    // client can reconcile its local state with a force refresh.
    const expectedVersion = (body as { expected_version?: number }).expected_version;
    const currentVersion = (currentTask as any)?.version ?? 0;
    let versionWarning: string | undefined;
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      versionWarning = `Version mismatch: client expected ${expectedVersion}, server has ${currentVersion}. Applied last-write-wins; refresh to reconcile.`;
    }

    if (currentTask) {
      update.version = currentVersion + 1;
    } // Apply last-write-wins (backward compatible) — no early rejection.

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

    return NextResponse.json({
      task: await enrichTaskRow(data as TasksRow),
      ...(versionWarning ? { warning: versionWarning } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/tasks/[id] — Delete task with cascade cleanup ────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const { id: taskId } = await params;
    const supabase = createServerClient();

    // Verify the task belongs to the same workspace as the worker
    const { data: taskData } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .single();

    if (!taskData) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    if ((taskData as any).workspace_id !== worker.workspace_id) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // Cascade delete related rows manually (tables without ON DELETE CASCADE)
    const anySupabase = supabase as any;

    // Clean up task_relations
    await anySupabase
      .from('task_relations')
      .delete()
      .or(`source_task_id.eq.${taskId},target_task_id.eq.${taskId}`);

    // Clean up task_column_history
    await anySupabase
      .from('task_column_history')
      .delete()
      .eq('task_id', taskId);

    // Clean up assignment_history
    await anySupabase
      .from('assignment_history')
      .delete()
      .eq('task_id', taskId);

    // Clean up enrichments
    await anySupabase
      .from('enrichments')
      .delete()
      .eq('task_id', taskId);

    // Clean up vector_chunks for this task
    await anySupabase
      .from('task_vector_chunks')
      .delete()
      .eq('task_id', taskId);

    // Clean up bot_task_drafts
    await anySupabase
      .from('bot_task_drafts')
      .delete()
      .eq('task_id', taskId);

    // Finally, delete the task itself
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (deleteError) {
      console.error('tasks: delete error', deleteError);
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 },
      );
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

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
