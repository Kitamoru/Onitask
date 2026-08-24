'use server';

/**
 * Sprint API — Update, Activate, and Delete endpoints.
 *
 * PATCH  /api/sprints/:id          — update sprint (name, dates, goal, status)
 * PATCH  /api/sprints/:id/activate — transition planning → active
 * DELETE /api/sprints/:id          — physically remove sprint from DB
 *
 * Uses Telegram initData auth (same pattern as /api/tasks).
 *
 * Sprint lifecycle:
 *   [created] → planning → [activate] → active → [complete/delete] → removed
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../lib/api-auth';
import type { Database } from '../../../../../types/supabase';

type SprintUpdate = Database['public']['Tables']['sprints']['Update'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Единый 404: спринта нет или нет доступа (не раскрываем существование). */
function sprintNotFound() {
  return NextResponse.json({ error: 'Спринт не найден' }, { status: 404 });
}

// ─── PATCH /api/sprints/:id — Update sprint ──────────────────────────────────
// Note: PATCH /:id/activate is handled by src/app/api/sprints/[id]/activate/route.ts

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sprintId } = await params;

    // Auth: извлекаем initData из КЛОНА запроса ДО любого чтения тела.
    // Если сначала вызвать request.json(), то request.clone() внутри
    // extractInitData бросит TypeError — и авторизация молча потеряется → 404.
    const initData = await extractInitData(request);
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const body = await request.json();
    const { name, start_date, end_date, goal, capacity, task_ids } = body;

    const supabase = createServerClient();

    // Build update payload with only provided fields.
    // NOTE: `status` is intentionally NOT accepted here — sprint lifecycle
    // transitions (planning → active → completed) are handled exclusively by
    // dedicated endpoints (/activate, /complete) to enforce the state machine.
    const updatePayload: SprintUpdate = {};
    if (name !== undefined) updatePayload.name = name.trim();
    if (start_date !== undefined) updatePayload.start_date = start_date;
    if (end_date !== undefined) updatePayload.end_date = end_date;
    if (goal !== undefined) updatePayload.goal = goal;
    if (capacity !== undefined) {
      updatePayload.capacity = capacity ? parseInt(String(capacity), 10) : null;
    }

    // Find sprint by ID only → get workspace_id from the sprint itself.
    // This avoids the non-deterministic "first active worker" issue when a user
    // has multiple workspaces (worker.workspace_id may not match the sprint's).
    const { data: existing, error: fetchError } = await supabase
      .from('sprints')
      .select('id, workspace_id')
      .eq('id', sprintId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!existing) {
      return sprintNotFound();
    }

    // Tenancy: активное членство профиля в воркспейсе самого спринта
    // (resource-scoped — не «первый активный воркер», недетерминированный).
    if (!(await isWorkspaceMember(auth.profileId!, existing.workspace_id))) {
      return sprintNotFound();
    }

    const { data: sprint, error: sprintError } = await supabase
      .from('sprints')
      .update(updatePayload)
      .eq('id', sprintId)
      .eq('workspace_id', existing.workspace_id)
      .select()
      .maybeSingle();

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
        .eq('sprint_id', sprintId)
        .eq('workspace_id', existing.workspace_id)
        .not('id', 'in', `(${task_ids.join(',')})`);

      // Then, assign new tasks to the sprint
      if (task_ids.length > 0) {
        await supabase
          .from('tasks')
          .update({ sprint_id: sprintId })
          .in('id', task_ids)
          .eq('workspace_id', existing.workspace_id);
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

// ─── DELETE /api/sprints/:id — Physically remove sprint ──────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sprintId } = await params;

    // Auth: см. комментарий в PATCH — initData один раз, до любого чтения тела.
    const initData = await extractInitData(request);
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();

    // Verify the sprint exists and belongs to the worker's workspace before deleting.
    // Prevents silent success when the sprint doesn't exist or belongs to another workspace.
    const { data: existing, error: fetchError } = await supabase
      .from('sprints')
      .select('id, workspace_id')
      .eq('id', sprintId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Спринт не найден' },
        { status: 404 },
      );
    }

    // Tenancy: активное членство профиля в воркспейсе самого спринта.
    if (!(await isWorkspaceMember(auth.profileId!, existing.workspace_id))) {
      return sprintNotFound();
    }

    // Physically delete the sprint row
    const { error } = await supabase
      .from('sprints')
      .delete()
      .eq('id', sprintId)
      .eq('workspace_id', existing.workspace_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
