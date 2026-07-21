'use server';

/**
 * GET /api/workspaces/my-data — Returns authenticated user's workspace data.
 *
 * Replaces direct client-side Supabase queries that fail due to RLS (no Supabase Auth session).
 * Uses Telegram initData validation for auth (same as /api/init and /api/workspaces).
 *
 * Response:
 *   workers: Array of worker records for the authenticated user
 *   workspaces: Array of workspace records the user belongs to
 *   tasks: Array of task records across all user's workspaces (for risk pulse)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;

    // Authenticate via Telegram initData
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();
    const profileId = auth.profileId!;

    // 1. Get all active workers for this profile
    const { data: workersData, error: workersError } = await supabase
      .from('workers')
      .select('*')
      .eq('source_id', profileId)
      .eq('is_active', true);

    if (workersError) {
      console.error('my-data: workers query error', workersError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    const workers = workersData || [];
    const workspaceIds = workers.map((w: any) => w.workspace_id).filter(Boolean);

    // 2. Get workspaces
    let workspaces: any[] = [];
    if (workspaceIds.length > 0) {
      const { data: wsData, error: wsError } = await supabase
        .from('workspaces')
        .select('*')
        .in('id', workspaceIds);

      if (wsError) {
        console.error('my-data: workspaces query error', wsError);
      }
      workspaces = wsData || [];
    }

    // 3. Get tasks across all workspaces (for risk pulse aggregation)
    let tasks: any[] = [];
    if (workspaceIds.length > 0) {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('id, column, escalation_reason, assigned_to, workspace_id, title, task_number, is_inbox, updated_at, priority, deadline')
        .in('workspace_id', workspaceIds);

      if (taskError) {
        console.error('my-data: tasks query error', taskError);
      }
      tasks = taskData || [];
    }

    return NextResponse.json({
      success: true,
      data: {
        workers,
        workspaces,
        tasks,
      },
    });
  } catch (err) {
    console.error('my-data: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}