'use server';

/**
 * Activate Sprint Endpoint
 *
 * PATCH /api/sprints/:id/activate — transition planning → active
 *
 * Uses Telegram initData auth (same pattern as /api/tasks).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../../lib/api-auth';

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

// ─── PATCH /api/sprints/:id/activate — Transition planning → active ──────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sprintId } = await params;
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Find sprint by ID only → get workspace_id from the sprint itself.
    // This avoids the non-deterministic "first active worker" issue when a user
    // has multiple workspaces (worker.workspace_id may not match the sprint's).
    const { data: sprint, error: fetchError } = await supabase
      .from('sprints')
      .select('id, status, workspace_id')
      .eq('id', sprintId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!sprint) {
      return NextResponse.json(
        { error: 'Спринт не найден' },
        { status: 404 },
      );
    }

    // Tenant isolation: verify the authenticated worker belongs to the sprint's workspace
    if (sprint.workspace_id !== worker.workspace_id) {
      return NextResponse.json(
        { error: 'Спринт не найден' },
        { status: 404 },
      );
    }

    if (sprint.status !== 'planning') {
      return NextResponse.json(
        { error: `Нельзя активировать спринт со статусом "${sprint.status}". Допустимый статус: planning.` },
        { status: 400 },
      );
    }

    // Activate the sprint atomically — the `.eq('status', 'planning')` condition
    // prevents a TOCTOU race where two parallel activate requests could both
    // transition the sprint to 'active'. Only one will match the condition.
    const { data: updated, error: updateError } = await supabase
      .from('sprints')
      .update({ status: 'active' })
      .eq('id', sprintId)
      .eq('workspace_id', sprint.workspace_id)
      .eq('status', 'planning')
      .select()
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Спринт не найден или уже активирован' },
        { status: 404 },
      );
    }

    return NextResponse.json({ sprint: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}