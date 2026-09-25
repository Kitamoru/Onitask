'use server';

/**
 * Sprint API — List and Create endpoints.
 *
 * GET  /api/sprints          — list sprints for the authenticated worker's workspace
 * POST /api/sprints          — create a new sprint
 *
 * Uses Telegram initData auth (same pattern as /api/tasks).
 *
 * Based on: Master §6.2, flow_.md §7
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  getUserWorkspaceIds,
  isWorkspaceMember,
} from '../../../../lib/api-auth';

// ─── GET /api/sprints — List sprints ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const requestedWorkspaceId = url.searchParams.get('workspace_id') || undefined;

    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const supabase = createServerClient();

    // All workspace IDs the user is an active member of. A user may belong to
    // several workspaces, so `.limit(1)` on a non-deterministic order would
    // silently return sprints from the wrong board.
    const workspaceIds = await getUserWorkspaceIds(auth.profileId!);

    if (requestedWorkspaceId && !workspaceIds.includes(requestedWorkspaceId)) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    let query = supabase.from('sprints').select('*');
    if (requestedWorkspaceId) {
      query = query.eq('workspace_id', requestedWorkspaceId);
    } else if (workspaceIds.length > 0) {
      query = query.in('workspace_id', workspaceIds);
    } else {
      return NextResponse.json({ sprints: [] });
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sprints: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── POST /api/sprints — Create sprint ───────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth: единая точка извлечения initData из клона ДО чтения тела.
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const body = await request.json();
    // Accept both snake_case (DB convention) and camelCase (frontend convention)
    const {
      name,
      start_date: sd,
      startDate,
      end_date: ed,
      endDate,
      goal,
      capacity,
      task_ids,
      taskIds,
      workspace_id: requestedWorkspaceId,
    } = body as Record<string, unknown>;
    const start_date = (sd ?? startDate) as string | undefined;
    const end_date = (ed ?? endDate) as string | undefined;
    const sprintTaskIds = (task_ids ?? taskIds) as unknown;

    // Validation: name + dates are required
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Поле "name" обязательно' },
        { status: 400 },
      );
    }
    if (!start_date || !end_date) {
      return NextResponse.json(
        { error: 'Поля "start_date" и "end_date" обязательны' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Use explicitly provided workspace_id. Fall back to the user's first
    // workspace (deterministic member list — not a non-deterministic
    // `.limit(1)` worker, which can point at the wrong board).
    const userWorkspaceIds = await getUserWorkspaceIds(auth.profileId!);
    const targetWorkspaceId = (requestedWorkspaceId as string) || userWorkspaceIds[0];

    if (!targetWorkspaceId) {
      return NextResponse.json(
        { error: 'У вас нет активных workspace' },
        { status: 403 },
      );
    }

    // Validate that the worker belongs to this workspace
    // (resource-scoped membership, not "first active worker").
    if (!(await isWorkspaceMember(auth.profileId!, targetWorkspaceId))) {
      return NextResponse.json(
        { error: 'Доступ запрещён: вы не являетесь участником этого workspace' },
        { status: 403 },
      );
    }

    // Create the sprint
    const { data: sprint, error: sprintError } = await supabase
      .from('sprints')
      .insert({
        workspace_id: targetWorkspaceId,
        name: name.trim(),
        start_date,
        end_date,
        goal: (goal ?? null) as string | null,
        capacity: capacity ? parseInt(String(capacity), 10) : null,
        status: 'planning',
      })
      .select()
      .maybeSingle();

    if (sprintError) {
      return NextResponse.json({ error: sprintError.message }, { status: 500 });
    }

    if (!sprint) {
      return NextResponse.json(
        { error: 'Не удалось создать спринт' },
        { status: 500 },
      );
    }

    // If task_ids provided, assign them to the sprint
    if (Array.isArray(sprintTaskIds) && sprintTaskIds.length > 0) {
      const { error: tasksError } = await supabase
        .from('tasks')
        .update({ sprint_id: sprint.id })
        .in('id', sprintTaskIds)
        .eq('workspace_id', targetWorkspaceId);

      if (tasksError) {
        // Sprint created but task assignment failed — return sprint with warning
        return NextResponse.json(
          { sprint, warning: 'Задачи не были добавлены в спринт' },
          { status: 201 },
        );
      }
    }

    return NextResponse.json({ sprint }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}