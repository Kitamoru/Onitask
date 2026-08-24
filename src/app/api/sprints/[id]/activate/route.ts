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
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../lib/api-auth';

/** Единый 404: спринта нет или нет доступа. */
function sprintNotFound() {
  return NextResponse.json({ error: 'Спринт не найден' }, { status: 404 });
}

// ─── PATCH /api/sprints/:id/activate — Transition planning → active ──────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sprintId } = await params;

    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
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
      return sprintNotFound();
    }

    // Tenancy: активное членство профиля в воркспейсе самого спринта
    // (resource-scoped — не «первый активный воркер», недетерминированный).
    if (!(await isWorkspaceMember(auth.profileId!, sprint.workspace_id))) {
      return sprintNotFound();
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