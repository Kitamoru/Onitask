'use server';

/**
 * POST /api/workspaces/my-data — Returns authenticated user's workspace data + flow metrics.
 *
 * Consolidated endpoint: returns workers, workspaces, tasks AND pre-computed metrics
 * in a single HTTP call.
 *
 * Optimization: when `partial: true` + `workspace_id` is provided, only tasks for the
 * requested workspace are fetched (not all tasks across all workspaces). This significantly
 * reduces query time and bandwidth when switching boards.
 *
 * DB queries are parallelized: workspaces, tasks, settings, and sprints are fetched
 * concurrently after the workers query (which provides workspaceIds).
 *
 * Response:
 *   workers: Array of worker records for the authenticated user
 *   workspaces: Array of workspace records the user belongs to
 *   tasks: Full task records (filtered to workspace_id when partial=true)
 *   metrics: Pre-computed flow metrics (sprint, columns, alerts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import type { Database } from '../../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type WorkersRow = Database['public']['Tables']['workers']['Row'];
type SprintsRow = Database['public']['Tables']['sprints']['Row'];

interface FlowMetricsResponse {
  sprintEnabled: boolean;
  sprint: {
    id: string;
    name: string;
    topic: string;
    startDate: string;
    endDate: string;
    daysElapsed: number;
    totalDays: number;
    progress: number;
    doneSP: number;
    totalSP: number;
    inProgress: number;
    onReview: number;
    isActive: boolean;
    status?: string;
  } | null;
  columns: Array<{
    name: string;
    wip_current: number;
    wip_limit?: number | null;
    health: 'green' | 'yellow' | 'red';
  }>;
  workers: Array<{
    display_name: string;
    type: 'human' | 'agent';
    status: 'ok' | 'overloaded';
    cognitive_load: number;
  }>;
  alerts: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  cached_at: string;
  cache_ttl: { columns: number; workers: number; alerts: number };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;
    const requestedWorkspaceId = body.workspace_id as string | undefined;
    const isPartial = body.partial as boolean | undefined;

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

    // 1. Get all active workers for this profile (needed for workspaceIds + board cards)
    const { data: userWorkersData, error: userWorkersError } = await supabase
      .from('workers')
      .select('*')
      .eq('source_id', profileId)
      .eq('is_active', true);

    if (userWorkersError) {
      console.error('my-data: user workers query error', userWorkersError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    const userWorkers = userWorkersData || [];
    const workspaceIds = userWorkers.map((w: any) => w.workspace_id).filter(Boolean);
    const metricsWorkspaceId = requestedWorkspaceId || workspaceIds[0] || null;

    // When partial load with workspace_id, only fetch tasks for that workspace
    // (full load fetches tasks across all workspaces for board cards)
    const taskWorkspaceIds = (isPartial && requestedWorkspaceId) ? [requestedWorkspaceId] : workspaceIds;

    // 2. Parallelize: fetch workspaces, tasks, settings, sprints, AND all workspace workers concurrently
    // This reduces 4+ sequential DB roundtrips to 1 parallel roundtrip
    // All workspace workers are needed for FlowBoard metrics (shows ALL colleagues, not just current user)
    const [allWorkspaceWorkersResult, wsResult, taskResult, settingsResult, sprintResult] = await Promise.all([
      // All active workers in user's workspaces (for FlowBoard metrics)
      workspaceIds.length > 0
        ? supabase.from('workers').select('*').in('workspace_id', workspaceIds).eq('is_active', true)
        : Promise.resolve({ data: [], error: null as any }),
      // Workspaces (always fetch all — needed for board cards on full load)
      workspaceIds.length > 0
        ? supabase.from('workspaces').select('*').in('id', workspaceIds)
        : Promise.resolve({ data: [], error: null as any }),
      // Tasks (filtered to single workspace when partial load)
      taskWorkspaceIds.length > 0
        ? supabase.from('tasks').select('*').in('workspace_id', taskWorkspaceIds)
        : Promise.resolve({ data: [], error: null as any }),
      // Workspace settings (for sprint_enabled flag)
      metricsWorkspaceId
        ? supabase.from('workspace_settings').select('story_points_config').eq('workspace_id', metricsWorkspaceId).single()
        : Promise.resolve({ data: null, error: null as any }),
      // Active sprint (for sprint metrics)
      metricsWorkspaceId
        ? supabase.from('sprints').select('*').eq('workspace_id', metricsWorkspaceId).in('status', ['active', 'planning']).order('created_at', { ascending: false }).limit(1)
        : Promise.resolve({ data: null, error: null as any }),
    ]);

    if (allWorkspaceWorkersResult.error) console.error('my-data: all workers query error', allWorkspaceWorkersResult.error);

    if (wsResult.error) console.error('my-data: workspaces query error', wsResult.error);
    if (taskResult.error) console.error('my-data: tasks query error', taskResult.error);

    const allWorkspaceWorkers = allWorkspaceWorkersResult.data || [];
    const workspaces = wsResult.data || [];
    const tasks = taskResult.data || [];
    const relevantTasks = metricsWorkspaceId ? tasks.filter((t: any) => t.workspace_id === metricsWorkspaceId) : tasks;

    // 3. Compute metrics from ALL workspace workers (not just current user's workers)
    // This ensures FlowBoard shows all colleagues, including those who joined via invite links
    const metrics = computeMetricsFromData(
      allWorkspaceWorkers,
      tasks,
      metricsWorkspaceId,
      relevantTasks,
      settingsResult.data as any,
      sprintResult.data as any,
    );

    return NextResponse.json({
      success: true,
      data: {
        workers: userWorkers, // Keep user-specific workers for backward compat (board cards)
        allWorkspaceWorkers, // New field: all workers in workspace (for FlowBoard metrics)
        workspaces,
        tasks,
        metrics,
      },
    });
  } catch (err) {
    console.error('my-data: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

/**
 * Compute flow metrics from pre-fetched data (no DB queries).
 * This is separated from the route handler to enable parallel DB queries.
 */
function computeMetricsFromData(
  workers: WorkersRow[],
  tasks: TasksRow[],
  workspaceId: string | null,
  relevantTasks: TasksRow[],
  settingsData: any,
  sprintData: any,
): FlowMetricsResponse {
  let sprint: FlowMetricsResponse['sprint'] = null;
  let sprintEnabled = false;

  if (workspaceId) {
    // Sprint enabled flag from pre-fetched settings
    sprintEnabled = (settingsData?.story_points_config as any)?.sprint_enabled ?? false;

    // Sprint data from pre-fetched query
    if (sprintData && (sprintData as SprintsRow[]).length > 0) {
      const sp = (sprintData as SprintsRow[])[0];

      // Calculate sprint metrics from actual data
      const startDate = sp.start_date ? new Date(sp.start_date) : null;
      const endDate = sp.end_date ? new Date(sp.end_date) : null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let daysElapsed = 0;
      let totalDays = 7;
      let progress = 0;

      if (startDate && endDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

        if (today >= start) {
          daysElapsed = Math.min(totalDays, Math.ceil((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        } else {
          daysElapsed = 0;
        }

        progress = totalDays > 0 ? Math.round((daysElapsed / totalDays) * 100) : 0;
        progress = Math.min(100, Math.max(0, progress));
      }

      // Count tasks by status for this sprint
      const sprintTasks = (relevantTasks || tasks).filter((t: any) => t.sprint_id === sp.id);
      const doneSP = sprintTasks
        .filter((t: any) => t.column === 'done' && t.story_points)
        .reduce((sum: number, t: any) => sum + (t.story_points as number), 0);
      const inProgress = sprintTasks.filter((t: any) => t.column === 'in_progress').length;
      const onReview = sprintTasks.filter((t: any) => t.column === 'review').length;

      sprint = {
        id: sp.id,
        name: sp.name || '',
        topic: sp.goal || '',
        startDate: sp.start_date || '',
        endDate: sp.end_date || '',
        daysElapsed,
        totalDays,
        progress,
        doneSP,
        totalSP: sp.capacity ?? 0,
        inProgress,
        onReview,
        isActive: sp.status === 'active',
        status: sp.status,
      };
    }
  }

  // Column counts
  const columnMap: Record<string, number> = { backlog: 0, in_progress: 0, review: 0, done: 0 };
  relevantTasks.forEach((t) => {
    if (t.column in columnMap) {
      columnMap[t.column]++;
    }
  });

  const wipLimits: Record<string, number | null> = {
    backlog: 15, in_progress: 5, review: 4, done: null,
  };

  const columns: FlowMetricsResponse['columns'] = Object.entries(columnMap).map(([name, wip_current]) => {
    const wip_limit = wipLimits[name] ?? null;
    let health: 'green' | 'yellow' | 'red' = 'green';
    if (wip_limit !== null && wip_current > wip_limit) health = 'red';
    else if (wip_limit !== null && wip_current >= wip_limit * 0.8) health = 'yellow';
    return { name, wip_current, wip_limit, health };
  });

  // Worker load — filter workers for this workspace
  const relevantWorkers = workspaceId ? workers.filter((w) => w.workspace_id === workspaceId) : workers;
  const overloadThreshold = 6;
  const workersMetrics: FlowMetricsResponse['workers'] = relevantWorkers.map((w) => {
    const cognitive_load = w.type === 'human' ? Math.min(3, 1) : 0;
    return {
      display_name: w.display_name || w.id.slice(0, 8),
      type: w.type as 'human' | 'agent',
      cognitive_load,
      status: cognitive_load >= 3 ? 'overloaded' : 'ok',
    };
  });

  // Alerts
  const alerts: FlowMetricsResponse['alerts'] = [];
  for (const wm of workersMetrics) {
    if (wm.status === 'overloaded') {
      alerts.push({
        type: 'overloaded_member',
        severity: 'high',
        message: `${wm.display_name} перегружен: ${wm.cognitive_load} / ${overloadThreshold}`,
      });
    }
  }
  for (const col of columns) {
    if (col.health === 'red') {
      alerts.push({
        type: 'bottleneck',
        severity: 'high',
        message: `Колонка "${col.name}" перегружена: ${col.wip_current} задач при лимите ${col.wip_limit}`,
      });
    }
  }

  return {
    sprintEnabled,
    sprint,
    columns,
    workers: workersMetrics,
    alerts,
    cached_at: new Date().toISOString(),
    cache_ttl: { columns: 5, workers: 60, alerts: 60 },
  };
}