'use server';

/**
 * POST /api/workspaces/my-data — Returns authenticated user's workspace data + flow metrics.
 *
 * Consolidated endpoint: returns workers, workspaces, tasks AND pre-computed metrics
 * in a single HTTP call. This eliminates the previous pattern of:
 *   1. GET /api/workspaces/my-data (tasks + workers + workspaces)
 *   2. POST /api/flow/metrics (sprint + columns + alerts)
 *   3. GET /api/tasks (full task details)
 *
 * All three are now served from one endpoint, reducing HTTP roundtrips from 3 to 1.
 *
 * Response:
 *   workers: Array of worker records for the authenticated user
 *   workspaces: Array of workspace records the user belongs to
 *   tasks: Full task records across all user's workspaces
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
    // Optional workspace_id override — when provided, metrics are computed for this workspace
    const requestedWorkspaceId = body.workspace_id as string | undefined;

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

    // 3. Get full tasks across all workspaces
    let tasks: any[] = [];
    if (workspaceIds.length > 0) {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .in('workspace_id', workspaceIds);

      if (taskError) {
        console.error('my-data: tasks query error', taskError);
      }
      tasks = taskData || [];
    }

    // 4. Compute flow metrics — use requestedWorkspaceId if provided, else fallback to first workspace
    const metricsWorkspaceId = requestedWorkspaceId || workspaceIds[0] || null;
    const metrics = await computeMetrics(workers, tasks, metricsWorkspaceId, supabase);

    return NextResponse.json({
      success: true,
      data: {
        workers,
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

async function computeMetrics(
  workers: WorkersRow[],
  tasks: TasksRow[],
  workspaceId: string | null,
  supabase: ReturnType<typeof createServerClient>,
): Promise<FlowMetricsResponse> {
  let sprint: FlowMetricsResponse['sprint'] = null;
  let sprintEnabled = false;

  if (workspaceId) {
    // Get workspace settings for sprint_enabled
    const { data: settingsData } = await supabase
      .from('workspace_settings')
      .select('story_points_config')
      .eq('workspace_id', workspaceId)
      .single();
    sprintEnabled = ((settingsData as any)?.story_points_config as any)?.sprint_enabled ?? false;

    // Get active sprint
    const { data: sprintData } = await supabase
      .from('sprints')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'planning'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (sprintData && (sprintData as SprintsRow[]).length > 0) {
      const sp = (sprintData as SprintsRow[])[0];
      sprint = {
        id: sp.id,
        name: sp.name || '',
        topic: '',
        startDate: sp.start_date || '',
        endDate: sp.end_date || '',
        daysElapsed: 0,
        totalDays: 7,
        progress: 0,
        doneSP: 0,
        totalSP: sp.capacity ?? 0,
        inProgress: 0,
        onReview: 0,
        isActive: sp.status === 'active',
      };
    }
  }

  // Column counts — filter tasks for this workspace if specified
  const relevantTasks = workspaceId ? tasks.filter((t) => t.workspace_id === workspaceId) : tasks;
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
