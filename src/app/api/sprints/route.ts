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
import { authenticateRequest } from '../../../../lib/api-auth';

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

// ─── GET /api/sprints — List sprints ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('workspace_id', worker.workspace_id)
      .order('created_at', { ascending: false });

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
    const worker = await getAuthenticatedWorker(request);
    if (!worker) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
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
    } = body as Record<string, unknown>;
    const start_date = (sd ?? startDate) as string | undefined;
    const end_date = (ed ?? endDate) as string | undefined;

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

    // Create the sprint
    const { data: sprint, error: sprintError } = await supabase
      .from('sprints')
      .insert({
        workspace_id: worker.workspace_id,
        name: name.trim(),
        start_date,
        end_date,
        goal: (goal ?? null) as string | null,
        capacity: capacity ? parseInt(String(capacity), 10) : null,
        status: 'planning',
      })
      .select()
      .single();

    if (sprintError) {
      return NextResponse.json({ error: sprintError.message }, { status: 500 });
    }

    // If task_ids provided, assign them to the sprint
    if (Array.isArray(task_ids) && task_ids.length > 0) {
      const { error: tasksError } = await supabase
        .from('tasks')
        .update({ sprint_id: sprint.id })
        .in('id', task_ids)
        .eq('workspace_id', worker.workspace_id);

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