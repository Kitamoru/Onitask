'use server';

/**
 * Sprint API — Update and Complete endpoints.
 *
 * PATCH  /api/sprints/:id   — update sprint (name, dates, goal, status)
 * DELETE /api/sprints/:id   — complete sprint (set status to 'completed')
 *
 * Uses Telegram initData auth (same pattern as /api/tasks).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import type { Database } from '../../../../../types/supabase';

type SprintUpdate = Database['public']['Tables']['sprints']['Update'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthenticatedWorker(req: NextRequest) {
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
    .select('id, workspace_id, source_id, type, role')
    .eq('source_id', auth.profileId!)
    .eq('is_active', true)
    .limit(1);

  return workers?.[0] ?? null;
}

// ─── PATCH /api/sprints/:id — Update sprint ──────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const body = await request.json();
    const { name, start_date, end_date, goal, status, task_ids } = body;

    const supabase = createServerClient();

    // Build update payload with only provided fields
    const updatePayload: SprintUpdate = {};
    if (name !== undefined) updatePayload.name = name.trim();
    if (start_date !== undefined) updatePayload.start_date = start_date;
    if (end_date !== undefined) updatePayload.end_date = end_date;
    if (goal !== undefined) updatePayload.goal = goal;
    if (status !== undefined) updatePayload.status = status;

    const { data: sprint, error: sprintError } = await supabase
      .from('sprints')
      .update(updatePayload)
      .eq('id', params.id)
      .eq('workspace_id', worker.workspace_id)
      .select()
      .single();

    if (sprintError) {
      return NextResponse.json({ error: sprintError.message }, { status: 500 });
    }

    if (!sprint) {
      return NextResponse.json(
        { error: 'Спринт не найден' },
        { status: 404 },
      );
    }

    // If task_ids provided, update task assignments
    if (Array.isArray(task_ids)) {
      // First, remove sprint_id from tasks no longer in the sprint
      await supabase
        .from('tasks')
        .update({ sprint_id: null })
        .eq('sprint_id', params.id)
        .eq('workspace_id', worker.workspace_id)
        .not('id', 'in', `(${task_ids.join(',')})`);

      // Then, assign new tasks to the sprint
      if (task_ids.length > 0) {
        await supabase
          .from('tasks')
          .update({ sprint_id: params.id })
          .in('id', task_ids)
          .eq('workspace_id', worker.workspace_id);
      }
    }

    return NextResponse.json({ sprint });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/sprints/:id — Complete sprint ───────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Set sprint status to 'completed'
    const { data: sprint, error } = await supabase
      .from('sprints')
      .update({ status: 'completed' })
      .eq('id', params.id)
      .eq('workspace_id', worker.workspace_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!sprint) {
      return NextResponse.json(
        { error: 'Спринт не найден' },
        { status: 404 },
      );
    }

    return NextResponse.json({ sprint });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}