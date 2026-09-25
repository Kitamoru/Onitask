'use server';

/**
 * POST /api/flow/metrics вЂ” server-side Flow Board read model.
 * Uses the shared calculator so it cannot drift from my-data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest, getDefaultWorkspaceId } from '../../../../../lib/api-auth';
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

const EMPTY_METRICS = {
  sprintEnabled: false,
  sprint: null,
  columns: [],
  workers: [],
  alerts: [],
  risk: { people: 0, processes: 0, escalations: 0 },
  riskBreakdown: { people: [], processes: { reviewBacklog: [], stuck: [], orphanBlockers: [] }, escalations: [] },
  cached_at: new Date().toISOString(),
  cache_ttl: { columns: 5, workers: 60, alerts: 60 },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;
    const requestedWorkspaceId = body.workspace_id as string | undefined;
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || 'РќРµ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ' }, { status: auth.status || 401 });
    }

    const supabase = createServerClient();
    const anySupabase = supabase as any;
    const profileId = auth.profileId!;
    let workspaceId: string | null = null;

    if (requestedWorkspaceId) {
      const { data: accessWorker } = await supabase
        .from('workers')
        .select('workspace_id')
        .eq('source_id', profileId)
        .eq('workspace_id', requestedWorkspaceId)
        .eq('is_active', true)
        .limit(1);
      if (accessWorker?.length) workspaceId = requestedWorkspaceId;
    }
    if (!workspaceId) workspaceId = await getDefaultWorkspaceId(profileId);
    if (!workspaceId) return NextResponse.json({ success: true, data: EMPTY_METRICS });

    const [settingsResult, sprintResult, taskResult, enrichmentResult, workersResult, attentionResult, reviewResult, stuckResult, orphanResult, escalationResult] = await Promise.all([
      supabase.from('workspace_settings').select('story_points_config, flow_config, enable_cognitive_budget, velocity_window_days').eq('workspace_id', workspaceId).maybeSingle(),
      supabase.from('sprints').select('*').eq('workspace_id', workspaceId).in('status', ['active', 'planning']).order('created_at', { ascending: false }).limit(1),
      supabase.from('tasks').select('id, workspace_id, column, assigned_to, reviewer_id, handoff_to, cognitive_weight, is_inbox, is_blocked, needs_human, moved_to_column_at, sprint_id').eq('workspace_id', workspaceId),
      supabase.from('task_enrichments').select('task_id, story_points').eq('workspace_id', workspaceId),
      supabase.from('workers').select('*').eq('workspace_id', workspaceId).eq('is_active', true),
      anySupabase.from('attention_risk_pulse').select('worker_id, attention_risk_score, risk_level').eq('workspace_id', workspaceId),
      anySupabase.from('review_backlog').select('reviewer_id, reviewer_name, review_count, workspace_id').eq('workspace_id', workspaceId),
      anySupabase.from('stuck_tasks').select('id, title, column, assigned_to, assignee_name, hours_stuck, workspace_id').eq('workspace_id', workspaceId),
      anySupabase.from('orphan_blockers').select('id, title, column, assigned_to, assignee_name, hours_blocked, workspace_id').eq('workspace_id', workspaceId),
      anySupabase.from('pending_escalations').select('id, title, escalation_reason, workspace_id, assigned_agent, hours_pending').eq('workspace_id', workspaceId),
    ]);

    const tasks = (taskResult.data ?? []) as TasksRow[] as FlowMetricsTask[];
    const workers = (workersResult.data ?? []) as WorkersRow[] as FlowMetricsWorker[];
    const taskIds = tasks.map((task) => task.id);
    const { data: reworkRows } = taskIds.length > 0
      ? await anySupabase
          .from('task_column_history')
          .select('task_id, from_column, to_column, moved_at')
          .in('task_id', taskIds)
          .eq('from_column', 'review')
          .eq('to_column', 'in_progress')
      : { data: [] as unknown[] };
    const sprintRow = (sprintResult.data ?? [])[0] as SprintsRow | undefined;
    const sprintTaskStats = sprintRow ? getSprintTaskStats(tasks, sprintRow.id) : { taskIds: [], doneTasks: 0 };
    const sprint = sprintRow ? {
      id: sprintRow.id,
      name: sprintRow.name || '',
      topic: sprintRow.goal || '',
      startDate: sprintRow.start_date || '',
      endDate: sprintRow.end_date || '',
      daysElapsed: 0,
      totalDays: 7,
      progress: 0,
      doneSP: 0,
      totalSP: sprintRow.capacity ?? 0,
      inProgress: tasks.filter((task) => task.column === 'in_progress' && task.sprint_id === sprintRow.id).length,
      onReview: tasks.filter((task) => task.column === 'review' && task.sprint_id === sprintRow.id).length,
      isActive: sprintRow.status === 'active',
      ...sprintTaskStats,
      } : null;
    const settings = (settingsResult.data ?? {}) as { story_points_config?: { sprint_enabled?: boolean }; flow_config?: Record<string, unknown> | null; enable_cognitive_budget?: boolean; velocity_window_days?: number };
    const metrics = buildFlowMetrics({
      workspaceId,
      tasks,
      workers,
      attentionRiskRows: (attentionResult.data ?? []) as AttentionRiskRow[],
      reviewBacklogRows: (reviewResult.data ?? []) as ReviewBacklogRow[],
      stuckTaskRows: (stuckResult.data ?? []) as StuckTaskRow[],
      orphanBlockerRows: (orphanResult.data ?? []) as OrphanBlockerRow[],
      pendingEscalationRows: (escalationResult.data ?? []) as PendingEscalationRow[],
      enrichmentRows: (enrichmentResult.data ?? []) as { task_id: string; story_points: number | null }[],
      reworkRows: ((reworkRows ?? []) as Array<{ task_id: string; from_column: string; to_column: string; moved_at: string }>).map((row) => ({ ...row, worker_id: tasks.find((task) => task.id === row.task_id)?.assigned_to ?? '' })),
      velocityWindowDays: settings.velocity_window_days ?? 14,
      enableCognitiveBudget: settings.enable_cognitive_budget ?? true,
      flowConfig: settings.flow_config ?? null,
      sprint,
      sprintEnabled: settings.story_points_config?.sprint_enabled ?? false,
    });
    return NextResponse.json({ success: true, data: metrics });
  } catch (err) {
    console.error('metrics: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
