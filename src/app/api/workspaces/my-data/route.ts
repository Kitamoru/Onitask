'use server';

/**
 * POST /api/workspaces/my-data — Returns authenticated user's workspace data + flow metrics.
 *
 * Consolidated endpoint: returns workers, workspaces, tasks AND pre-computed metrics
 * in a single HTTP call.
 *
 * Optimization: when `partial: true` + `workspace_id` is provided, only tasks for the
 * requested workspace are fetched (not all tasks across all workspaces).
 *
 * Full load additionally returns `sprintsByWorkspace` — active/planning sprint summary
 * per workspace for BoardCard on /boards.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { enrichTaskRowsBatch, type EnrichedTask } from '../../../../../lib/taskEnrichment';
import type { Database } from '../../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type WorkersRow = Database['public']['Tables']['workers']['Row'];
type SprintsRow = Database['public']['Tables']['sprints']['Row'];

interface FlowMetricsResponse {
  sprintEnabled: boolean;
  sprint: {
    id: string;
    workspace_id: string;
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
    capacity?: string | null;
    doneTasks?: number;
    totalTasks?: number;
    taskIds?: string[];
  } | null;
  columns: Array<{
    name: string;
    wip_current: number;
    wip_limit?: number | null;
    health: 'green' | 'yellow' | 'red';
  }>;
  workers: Array<{
    id: string;
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

/** Краткая сводка спринта для BoardCard на /boards */
type BoardSprintSummary = {
  name: string;
  topic: string;
  daysElapsed: number;
  totalDays: number;
  status?: string;
  isActive?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;
    const requestedWorkspaceId = body.workspace_id as string | undefined;
    const isPartial = body.partial as boolean | undefined;

    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();
    const profileId = auth.profileId!;

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

    const taskWorkspaceIds =
      isPartial && requestedWorkspaceId ? [requestedWorkspaceId] : workspaceIds;

    // Full load: спринты по всем workspace. Partial: только активный.
    const sprintQueryWorkspaceIds =
      isPartial && requestedWorkspaceId ? [requestedWorkspaceId] : workspaceIds;

    const [
      allWorkspaceWorkersResult,
      wsResult,
      taskResult,
      settingsResult,
      sprintResult,
    ] = await Promise.all([
      workspaceIds.length > 0
        ? supabase
            .from('workers')
            .select('*')
            .in('workspace_id', workspaceIds)
            .eq('is_active', true)
        : Promise.resolve({ data: [], error: null as any }),

      workspaceIds.length > 0
        ? supabase.from('workspaces').select('*').in('id', workspaceIds)
        : Promise.resolve({ data: [], error: null as any }),

      taskWorkspaceIds.length > 0
        ? supabase.from('tasks').select('*').in('workspace_id', taskWorkspaceIds)
        : Promise.resolve({ data: [], error: null as any }),

      metricsWorkspaceId
        ? supabase
            .from('workspace_settings')
            .select('story_points_config')
            .eq('workspace_id', metricsWorkspaceId)
            .single()
        : Promise.resolve({ data: null, error: null as any }),

      sprintQueryWorkspaceIds.length > 0
        ? supabase
            .from('sprints')
            .select('*')
            .in('workspace_id', sprintQueryWorkspaceIds)
            .in('status', ['active', 'planning'])
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null as any }),
    ]);

    if (allWorkspaceWorkersResult.error) {
      console.error('my-data: all workers query error', allWorkspaceWorkersResult.error);
    }
    if (wsResult.error) {
      console.error('my-data: workspaces query error', wsResult.error);
    }
    if (taskResult.error) {
      console.error('my-data: tasks query error', taskResult.error);
    }
    if (sprintResult.error) {
      console.error('my-data: sprints query error', sprintResult.error);
    }

    const allWorkspaceWorkers = allWorkspaceWorkersResult.data || [];
    const workspaces = wsResult.data || [];
    const rawTasks = taskResult.data || [];

    const tasks: EnrichedTask[] = await enrichTaskRowsBatch(rawTasks as TasksRow[]);

    const relevantTasks = metricsWorkspaceId
      ? tasks.filter((t: EnrichedTask) => t.workspace_id === metricsWorkspaceId)
      : tasks;

    const allSprints = (sprintResult.data as SprintsRow[] | null) ?? [];

    // Metrics: только спринт активного (metrics) workspace
    const sprintsForMetrics = metricsWorkspaceId
      ? allSprints.filter((s) => s.workspace_id === metricsWorkspaceId)
      : [];

    const metrics = computeMetricsFromData(
      allWorkspaceWorkers,
      tasks,
      metricsWorkspaceId,
      relevantTasks,
      settingsResult.data as any,
      sprintsForMetrics,
    );

    // Per-workspace sprint summaries для BoardCard
    const sprintsByWorkspace = buildSprintsByWorkspace(allSprints);

    return NextResponse.json({
      success: true,
      data: {
        workers: userWorkers,
        allWorkspaceWorkers,
        workspaces,
        tasks,
        metrics,
        sprintsByWorkspace,
      },
    });
  } catch (err) {
    console.error('my-data: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

/**
 * По каждому workspace — последний active/planning спринт
 * (строки уже отсортированы по created_at desc).
 */
function buildSprintsByWorkspace(
  sprints: SprintsRow[],
): Record<string, BoardSprintSummary> {
  const byWs = new Map<string, SprintsRow>();

  for (const sp of sprints) {
    if (!sp.workspace_id) continue;
    if (!byWs.has(sp.workspace_id)) {
      byWs.set(sp.workspace_id, sp);
    }
  }

  const result: Record<string, BoardSprintSummary> = {};

  for (const [wsId, sp] of byWs) {
    const startDate = sp.start_date ? new Date(sp.start_date) : null;
    const endDate = sp.end_date ? new Date(sp.end_date) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let daysElapsed = 0;
    let totalDays = 7;

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      totalDays = Math.max(
        1,
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
      );
      if (today >= start) {
        daysElapsed = Math.min(
          totalDays,
          Math.ceil((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        );
      }
    }

    result[wsId] = {
      name: sp.name || '',
      topic: sp.goal || '',
      daysElapsed,
      totalDays,
      status: sp.status,
      isActive: sp.status === 'active',
    };
  }

  return result;
}

function computeMetricsFromData(
  workers: WorkersRow[],
  tasks: EnrichedTask[],
  workspaceId: string | null,
  relevantTasks: EnrichedTask[],
  settingsData: any,
  sprintData: any,
): FlowMetricsResponse {
  let sprint: FlowMetricsResponse['sprint'] = null;
  let sprintEnabled = false;

  if (workspaceId) {
    sprintEnabled =
      (settingsData?.story_points_config as any)?.sprint_enabled ?? false;

    if (sprintData && (sprintData as SprintsRow[]).length > 0) {
      const sp = (sprintData as SprintsRow[])[0];
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
        totalDays = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        );
        if (today >= start) {
          daysElapsed = Math.min(
            totalDays,
            Math.ceil((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
          );
        } else {
          daysElapsed = 0;
        }
        progress = totalDays > 0 ? Math.round((daysElapsed / totalDays) * 100) : 0;
        progress = Math.min(100, Math.max(0, progress));
      }

      const sprintTasks = (relevantTasks || tasks).filter(
        (t: any) => t.sprint_id === sp.id,
      );
      const doneSP = sprintTasks
        .filter((t: any) => t.column === 'done' && t.story_points)
        .reduce((sum: number, t: any) => sum + (t.story_points as number), 0);
      const inProgress = sprintTasks.filter(
        (t: any) => t.column === 'in_progress',
      ).length;
      const onReview = sprintTasks.filter((t: any) => t.column === 'review').length;
      const doneTasks = sprintTasks.filter((t: any) => t.column === 'done').length;
      const totalTasks = sprintTasks.length;

      sprint = {
        id: sp.id,
        workspace_id: workspaceId!,
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
        capacity: sp.capacity != null ? String(sp.capacity) : null,
        doneTasks,
        totalTasks,
        taskIds: sprintTasks.map((t: any) => t.id),
      };
    }
  }

  const columnMap: Record<string, number> = {
    backlog: 0,
    in_progress: 0,
    review: 0,
    done: 0,
  };
  relevantTasks.forEach((t) => {
    if (t.column in columnMap) {
      columnMap[t.column]++;
    }
  });

  const wipLimits: Record<string, number | null> = {
    backlog: 15,
    in_progress: 5,
    review: 4,
    done: null,
  };

  const columns: FlowMetricsResponse['columns'] = Object.entries(columnMap).map(
    ([name, wip_current]) => {
      const wip_limit = wipLimits[name] ?? null;
      let health: 'green' | 'yellow' | 'red' = 'green';
      if (wip_limit !== null && wip_current > wip_limit) health = 'red';
      else if (wip_limit !== null && wip_current >= wip_limit * 0.8) health = 'yellow';
      return { name, wip_current, wip_limit, health };
    },
  );

  const relevantWorkers = workspaceId
    ? workers.filter((w) => w.workspace_id === workspaceId)
    : workers;
  const overloadThreshold = 6;
  const workersMetrics: FlowMetricsResponse['workers'] = relevantWorkers.map((w) => {
    const cognitive_load = w.type === 'human' ? Math.min(3, 1) : 0;
    return {
      id: w.id,
      display_name: w.display_name || w.id.slice(0, 8),
      type: w.type as 'human' | 'agent',
      cognitive_load,
      status: cognitive_load >= 3 ? 'overloaded' : 'ok',
    };
  });

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
