'use server';

/**
 * POST /api/workspaces/my-data Р Р†Р вЂљРІР‚Сњ Returns authenticated user's workspace data + flow metrics.
 *
 * Consolidated endpoint: returns workers, workspaces, tasks AND pre-computed metrics
 * in a single HTTP call.
 *
 * Optimization: when `partial: true` + `workspace_id` is provided, only tasks for the
 * requested workspace are fetched (not all tasks across all workspaces).
 *
 * Full load additionally returns `sprintsByWorkspace` Р Р†Р вЂљРІР‚Сњ active/planning sprint summary
 * per workspace for BoardCard on /boards.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { enrichTaskRowsBatch, type EnrichedTask } from '../../../../../lib/taskEnrichment';
import { buildSprintsByWorkspace } from '../../../../lib/sprintSummary';
import {
  buildFlowMetrics,
  type AttentionRiskRow,
  type FlowMetricsTask,
  type FlowMetricsWorker,
  type OrphanBlockerRow,
  type PendingEscalationRow,
  type ReviewBacklogRow,
  type StuckTaskRow,
  getSprintTaskStats,
} from '../../../../lib/server/flowMetrics';
import type { Database } from '../../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type WorkersRow = Database['public']['Tables']['workers']['Row'];
type SprintsRow = Database['public']['Tables']['sprints']['Row'];

/** Р В РЎв„ўР РЋР вЂљР В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°Р РЋР РЏ Р РЋР С“Р В Р вЂ Р В РЎвЂўР В РўвЂР В РЎвЂќР В Р’В° Р РЋР С“Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В Р вЂ¦Р РЋРІР‚С™Р В Р’В° Р В РўвЂР В Р’В»Р РЋР РЏ BoardCard Р В Р вЂ¦Р В Р’В° /boards Р Р†Р вЂљРІР‚Сњ Р В РЎвЂР В Р’В· lib/sprintSummary */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;
    const requestedWorkspaceId = body.workspace_id as string | undefined;
    const isPartial = body.partial as boolean | undefined;

    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Р В РЎСљР В Р’Вµ Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();
    const anySupabase = supabase as any;
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
    if (requestedWorkspaceId && !workspaceIds.includes(requestedWorkspaceId)) {
      return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 });
    }
    const metricsWorkspaceId = requestedWorkspaceId || workspaceIds[0] || null;

    const taskWorkspaceIds =
      isPartial && requestedWorkspaceId ? [requestedWorkspaceId] : workspaceIds;

    // Full load: Р РЋР С“Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В Р вЂ¦Р РЋРІР‚С™Р РЋРІР‚в„– Р В РЎвЂ”Р В РЎвЂў Р В Р вЂ Р РЋР С“Р В Р’ВµР В РЎВ workspace. Partial: Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“.
    const sprintQueryWorkspaceIds =
      isPartial && requestedWorkspaceId ? [requestedWorkspaceId] : workspaceIds;

    const [
      allWorkspaceWorkersResult,
      wsResult,
      taskResult,
      enrichmentResult,
      settingsResult,
      attentionResult,
      reviewResult,
      stuckResult,
      orphanResult,
      escalationResult,
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

      taskWorkspaceIds.length > 0
        ? supabase.from('task_enrichments').select('task_id, story_points').in('workspace_id', taskWorkspaceIds)
        : Promise.resolve({ data: [], error: null as any }),

      metricsWorkspaceId
        ? supabase
            .from('workspace_settings')
            .select('story_points_config, flow_config, enable_cognitive_budget, velocity_window_days')
            .eq('workspace_id', metricsWorkspaceId)
            .single()
        : Promise.resolve({ data: null, error: null as any }),

      metricsWorkspaceId
        ? anySupabase
            .from('attention_risk_pulse')
            .select('worker_id, attention_risk_score, risk_level')
            .eq('workspace_id', metricsWorkspaceId)
        : Promise.resolve({ data: [], error: null as any }),

      metricsWorkspaceId
        ? anySupabase
            .from('review_backlog')
            .select('reviewer_id, reviewer_name, review_count, workspace_id')
            .eq('workspace_id', metricsWorkspaceId)
        : Promise.resolve({ data: [], error: null as any }),

      metricsWorkspaceId
        ? anySupabase
            .from('stuck_tasks')
            .select('id, title, column, assigned_to, assignee_name, hours_stuck, workspace_id')
            .eq('workspace_id', metricsWorkspaceId)
        : Promise.resolve({ data: [], error: null as any }),

      metricsWorkspaceId
        ? anySupabase
            .from('orphan_blockers')
            .select('id, title, column, assigned_to, assignee_name, hours_blocked, workspace_id')
            .eq('workspace_id', metricsWorkspaceId)
        : Promise.resolve({ data: [], error: null as any }),

      metricsWorkspaceId
        ? anySupabase
            .from('pending_escalations')
            .select('id, title, escalation_reason, workspace_id, assigned_agent, hours_pending')
            .eq('workspace_id', metricsWorkspaceId)
        : Promise.resolve({ data: [], error: null as any }),

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

    const rawTasks = taskResult.data || [];
    const taskIds = (rawTasks as Array<{ id: string }>).map((task) => task.id);
    const { data: reworkRows } = taskIds.length > 0
      ? await anySupabase
          .from('task_column_history')
          .select('task_id, from_column, to_column, moved_at')
          .in('task_id', taskIds)
          .eq('from_column', 'review')
          .eq('to_column', 'in_progress')
      : { data: [] as unknown[] };
    const workspaces = wsResult.data || [];
    const allWorkspaceWorkers = allWorkspaceWorkersResult.data || [];

    const tasks: EnrichedTask[] = await enrichTaskRowsBatch(rawTasks as TasksRow[]);
    const enrichmentByTask = new Map(
      ((enrichmentResult.data ?? []) as Array<{ task_id: string; story_points: number | null }>)
        .map((row) => [row.task_id, row.story_points]),
    );
    const tasksWithStoryPoints: EnrichedTask[] = tasks.map((task) => ({
      ...task,
      story_points: enrichmentByTask.get(task.id) ?? null,
    }));

    const relevantTasks = metricsWorkspaceId
      ? tasksWithStoryPoints.filter((t: EnrichedTask) => t.workspace_id === metricsWorkspaceId)
      : tasksWithStoryPoints;

    const allSprints = (sprintResult.data as SprintsRow[] | null) ?? [];

    // Metrics: Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р РЋР С“Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В Р вЂ¦Р РЋРІР‚С™ Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў (metrics) workspace
    const sprintsForMetrics = metricsWorkspaceId
      ? allSprints.filter((s) => s.workspace_id === metricsWorkspaceId)
      : [];

    const sprintTaskStats = sprintsForMetrics[0]
      ? getSprintTaskStats(relevantTasks, sprintsForMetrics[0].id)
      : { taskIds: [], doneTasks: 0 };
    const metrics = buildFlowMetrics({
      workspaceId: metricsWorkspaceId,
      tasks: relevantTasks as FlowMetricsTask[],
      workers: allWorkspaceWorkers as FlowMetricsWorker[],
      attentionRiskRows: (attentionResult.data ?? []) as AttentionRiskRow[],
      reviewBacklogRows: (reviewResult.data ?? []) as ReviewBacklogRow[],
      stuckTaskRows: (stuckResult.data ?? []) as StuckTaskRow[],
      orphanBlockerRows: (orphanResult.data ?? []) as OrphanBlockerRow[],
      pendingEscalationRows: (escalationResult.data ?? []) as PendingEscalationRow[],
      enableCognitiveBudget: (settingsResult.data as any)?.enable_cognitive_budget ?? true,
      storyPointsConfig: (settingsResult.data as any)?.story_points_config,
      enrichmentRows: (enrichmentResult.data ?? []) as { task_id: string; story_points: number | null }[],
      reworkRows: ((reworkRows ?? []) as Array<{ task_id: string; from_column: string; to_column: string; moved_at: string }>).map((row) => ({ ...row, worker_id: relevantTasks.find((task) => task.id === row.task_id)?.assigned_to ?? '' })),
      velocityWindowDays: (settingsResult.data as any)?.velocity_window_days ?? 14,
      flowConfig: (settingsResult.data as any)?.flow_config ?? null,
      sprint: sprintsForMetrics[0] ? {
        id: sprintsForMetrics[0].id,
        name: sprintsForMetrics[0].name || '',
        topic: sprintsForMetrics[0].goal || '',
        startDate: sprintsForMetrics[0].start_date || '',
        endDate: sprintsForMetrics[0].end_date || '',
        daysElapsed: 0,
        totalDays: 7,
        progress: 0,
        doneSP: 0,
        totalSP: sprintsForMetrics[0].capacity ?? 0,
        inProgress: 0,
        onReview: 0,
        isActive: sprintsForMetrics[0].status === 'active',
        ...sprintTaskStats,
      } : null,
      sprintEnabled: (settingsResult.data as any)?.story_points_config?.sprint_enabled === true,
    });

    // Per-workspace sprint summaries Р В РўвЂР В Р’В»Р РЋР РЏ BoardCard
    const sprintsByWorkspace = buildSprintsByWorkspace(allSprints);

    return NextResponse.json({
      success: true,
      data: {
        workers: userWorkers,
        allWorkspaceWorkers,
        workspaces,
        tasks: tasksWithStoryPoints,
        metrics,
        sprintsByWorkspace,
      },
    });
  } catch (err) {
    console.error('my-data: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
