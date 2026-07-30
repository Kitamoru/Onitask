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

    // Only allow activating sprints in 'planning' status
    const { data: sprint, error: fetchError } = await supabase
      .from('sprints')
      .select('id, status')
      .eq('id', sprintId)
      .eq('workspace_id', worker.workspace_id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!sprint) {
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

    // Activate the sprint
    const { data: updated, error: updateError } = await supabase
      .from('sprints')
      .update({ status: 'active' })
      .eq('id', sprintId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ sprint: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}