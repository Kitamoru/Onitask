
import type {
  AlertData,
  ColumnHealthData,
  FlowMetricsResponse,
  SprintInfo,
  WorkerMetricData,
} from '@/types/flowboard';
import { normalizeStoryPointsConfig } from '@/lib/storyPoints';

export interface FlowMetricsTask {
  id: string;
  workspace_id: string;
  column: string;
  assigned_to: string | null;
  reviewer_id: string | null;
  handoff_to?: string | null;
  cognitive_weight: number | null;
  is_inbox: boolean;
  is_blocked: boolean;
  needs_human: boolean;
  moved_to_column_at: string | null;
  story_points?: number | null;
  sprint_id?: string | null;
}

export interface FlowMetricsWorker {
  id: string;
  workspace_id: string;
  type: 'human' | 'agent';
  display_name: string;
  role: string | null;
  role_title: string | null;
}

export interface FlowMetricsReworkRow {
  task_id: string;
  worker_id: string;
  from_column: string;
  to_column: string;
  moved_at: string;
}

export interface FlowMetricsEnrichment {
  task_id: string;
  story_points: number | null;
}

export interface AttentionRiskRow {
  worker_id: string;
  attention_risk_score: number | string | null;
  risk_level: 'ok' | 'warning' | 'critical';
}

export interface ReviewBacklogRow {
  reviewer_id: string;
  reviewer_name: string | null;
  review_count: number;
  workspace_id: string;
}

export interface StuckTaskRow {
  id: string;
  title: string;
  column: string;
  assigned_to: string | null;
  assignee_name: string | null;
  hours_stuck: number | string | null;
  workspace_id: string;
}

export interface OrphanBlockerRow {
  id: string;
  title: string;
  column: string;
  assigned_to: string | null;
  assignee_name: string | null;
  hours_blocked: number | string | null;
  workspace_id: string;
}

export interface PendingEscalationRow {
  id: string;
  title: string;
  escalation_reason: string | null;
  workspace_id: string;
  assigned_agent: string | null;
  hours_pending: number | string | null;
}

export interface FlowRiskBreakdown {
  people: Array<{
    worker_id: string;
    display_name: string;
    cognitive_load: number;
    attention_risk_score: number;
    risk_level: AttentionRiskRow['risk_level'];
  }>;
  processes: {
    reviewBacklog: ReviewBacklogRow[];
    stuck: StuckTaskRow[];
    orphanBlockers: OrphanBlockerRow[];
  };
  escalations: PendingEscalationRow[];
}

export interface FlowRiskData {
  people: number;
  processes: number;
  escalations: number;
}

export interface BuildFlowMetricsInput {
  workspaceId: string | null;
  tasks: FlowMetricsTask[];
  workers: FlowMetricsWorker[];
  attentionRiskRows: AttentionRiskRow[];
  reviewBacklogRows: ReviewBacklogRow[];
  stuckTaskRows: StuckTaskRow[];
  orphanBlockerRows: OrphanBlockerRow[];
  pendingEscalationRows: PendingEscalationRow[];
  enrichmentRows?: FlowMetricsEnrichment[];
  reworkRows?: FlowMetricsReworkRow[];
  velocityWindowDays?: number;
  enableCognitiveBudget: boolean;
  storyPointsConfig?: unknown;
  flowConfig?: Record<string, unknown> | null;
  sprint?: SprintInfo | null;
  sprintEnabled?: boolean;
}

const COLUMN_NAMES = ['backlog', 'in_progress', 'review', 'done'] as const;
const WIP_LIMITS: Record<(typeof COLUMN_NAMES)[number], number | null> = {
  backlog: 15,
  in_progress: 5,
  review: 4,
  done: null,
};
const MAX_COGNITIVE_SLOTS = 3;

/** Task counts used by the compact sprint card and sprint edit sheet. */
export function getSprintTaskStats(
  tasks: Array<{ id: string; sprint_id?: string | null; column: string }>,
  sprintId: string,
): { taskIds: string[]; doneTasks: number } {
  const taskIds = tasks.filter((task) => task.sprint_id === sprintId).map((task) => task.id);
  const doneTasks = tasks.filter(
    (task) => task.sprint_id === sprintId && task.column === 'done',
  ).length;
  return { taskIds, doneTasks };
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function configuredNumber(config: Record<string, unknown> | null | undefined, key: string, fallback: number): number {
  const value = config?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cognitiveLoadForWorker(workerId: string, tasks: FlowMetricsTask[], enabled: boolean): number {
  if (!enabled) return 0;
  return Math.min(MAX_COGNITIVE_SLOTS, tasks.reduce((total, task) => {
    const isAssignedInProgress = task.column === 'in_progress' && task.assigned_to === workerId;
    const isReviewerReview = task.column === 'review' && task.reviewer_id === workerId;
    if (task.is_inbox || (!isAssignedInProgress && !isReviewerReview)) return total;
    return total + Math.max(0, numberValue(task.cognitive_weight));
  }, 0));
}

function makeColumns(tasks: FlowMetricsTask[]): ColumnHealthData[] {
  return COLUMN_NAMES.map((name) => {
    const wip_current = tasks.filter((task) => task.column === name && !task.is_inbox).length;
    const wip_limit = WIP_LIMITS[name];
    const health = wip_limit === null
      ? 'green'
      : wip_current > wip_limit
        ? 'red'
        : wip_current >= wip_limit * 0.8
          ? 'yellow'
          : 'green';
    return { name, wip_current, wip_limit, health, avg_cycle_time_hours: null };
  });
}

export function buildFlowMetrics(input: BuildFlowMetricsInput): FlowMetricsResponse & { risk: FlowRiskData; riskBreakdown: FlowRiskBreakdown } {
  const evaluationConfig = normalizeStoryPointsConfig(input.storyPointsConfig);
  const evaluation = {
    storyPointsEnabled: evaluationConfig.enabled,
    cognitiveWeightEnabled: input.enableCognitiveBudget,
    storyPointValues: evaluationConfig.values,
    hoursPerSp: evaluationConfig.hoursPerSp,
  };
  const scopedTasks = input.workspaceId
    ? input.tasks.filter((task) => task.workspace_id === input.workspaceId)
    : input.tasks;
  const scopedWorkers = input.workspaceId
    ? input.workers.filter((worker) => worker.workspace_id === input.workspaceId)
    : input.workers;
  const attentionByWorker = new Map(input.attentionRiskRows.map((row) => [row.worker_id, row]));
  const enrichmentByTask = new Map((input.enrichmentRows ?? []).map((row) => [row.task_id, row.story_points]));
  const velocityWindowDays = input.velocityWindowDays ?? 14;
  const velocityCutoff = new Date(Date.now() - velocityWindowDays * 24 * 60 * 60 * 1000);
  const reworkTasksByWorker = new Map<string, Set<string>>();
  for (const row of input.reworkRows ?? []) {
    if (row.from_column !== 'review' || row.to_column !== 'in_progress') continue;
    if (new Date(row.moved_at) < velocityCutoff) continue;
    const taskIds = reworkTasksByWorker.get(row.worker_id) ?? new Set<string>();
    taskIds.add(row.task_id);
    reworkTasksByWorker.set(row.worker_id, taskIds);
  }
  const columns = makeColumns(scopedTasks);
  const overloadThreshold = configuredNumber(input.flowConfig ?? null, 'overload_threshold', 6);

  const workerMetrics: WorkerMetricData[] = scopedWorkers.map((worker) => {
    const cognitiveLoad = cognitiveLoadForWorker(worker.id, scopedTasks, input.enableCognitiveBudget);
    const attention = attentionByWorker.get(worker.id);
    const completedSP = evaluation.storyPointsEnabled
      ? scopedTasks.reduce((sum, task) => {
          if (task.assigned_to !== worker.id || task.column !== 'done') return sum;
          if (!task.moved_to_column_at || new Date(task.moved_to_column_at) < velocityCutoff) return sum;
          return sum + Math.max(0, numberValue(enrichmentByTask.get(task.id) ?? task.story_points));
        }, 0)
      : undefined;
    const spPerDay = completedSP === undefined
      ? undefined
      : Math.round((completedSP / Math.max(1, velocityWindowDays)) * 10) / 10;
    const completedTaskCount = scopedTasks.filter((task) => task.assigned_to === worker.id && task.column === 'done' && task.moved_to_column_at && new Date(task.moved_to_column_at) >= velocityCutoff).length;
    const reworkCount = reworkTasksByWorker.get(worker.id)?.size ?? 0;
    const reworkRate = completedTaskCount > 0 ? Math.round((reworkCount / completedTaskCount) * 100) / 100 : 0;
    const pendingAgentEscalations = scopedTasks.filter(
      (task) => task.assigned_to === worker.id && task.needs_human && task.column !== 'done',
    ).length;
    const handoffCount = scopedTasks.filter(
      (task) => task.handoff_to === worker.id && task.column !== 'done',
    ).length;
    const throughput = worker.type === 'agent' ? Math.round((completedTaskCount / 7) * 10) / 10 : undefined;
    const interpretationHint = worker.type === 'agent'
      ? (throughput !== undefined && throughput < 0.5 && pendingAgentEscalations > 0
          ? 'Агент остановился. Разблокируй задачи'
          : throughput !== undefined && throughput >= 1.5 && reworkRate <= 0.15 && pendingAgentEscalations === 0
            ? 'Агент работает стабильно'
            : 'Агент работает, но есть вопросы. Проверь эскалации')
      : undefined;
    return {
      id: worker.id,
      display_name: worker.display_name || worker.id.slice(0, 8),
      type: worker.type,
      role: worker.role,
      role_title: worker.role_title,
      cognitive_load: cognitiveLoad,
      overload_threshold: overloadThreshold,
      status: cognitiveLoad >= MAX_COGNITIVE_SLOTS ? 'overloaded' : 'ok',
      attention_risk_score: numberValue(attention?.attention_risk_score),
      attention_risk_level: attention?.risk_level ?? 'ok',
      sp_per_day: spPerDay,
      velocity_window_days: velocityWindowDays,
      throughput,
      pending_escalations: worker.type === 'agent' ? pendingAgentEscalations : undefined,
      handoff_count: handoffCount,
      interpretation_hint: interpretationHint,
      completed_story_points: completedSP,
      rework_count: reworkCount,
      rework_rate: reworkRate,
      completed_task_count: completedTaskCount,
    };
  });

  const people = workerMetrics.filter((worker) => worker.type === 'human' && worker.cognitive_load >= MAX_COGNITIVE_SLOTS);
  const reviewBacklog = input.reviewBacklogRows.filter((row) => row.workspace_id === input.workspaceId);
  const stuck = input.stuckTaskRows.filter((row) => row.workspace_id === input.workspaceId);
  const orphanBlockers = input.orphanBlockerRows.filter((row) => row.workspace_id === input.workspaceId);
  const escalations = input.pendingEscalationRows.filter((row) => row.workspace_id === input.workspaceId);
  const alerts: AlertData[] = [
    ...people.map((worker) => ({
      type: 'overloaded_member',
      severity: 'high' as const,
      message: `${worker.display_name} перегружен: ${worker.cognitive_load} / ${MAX_COGNITIVE_SLOTS}`,
    })),
    ...(escalations.length > 0
      ? [{ type: 'escalation', severity: 'high' as const, message: 'Есть задачи, ожидающие решения' }]
      : []),
    ...columns.filter((column) => column.health === 'red').map((column) => ({
      type: 'bottleneck',
      severity: 'high' as const,
      message: `Колонка "${column.name}" перегружена: ${column.wip_current} задач при лимите ${column.wip_limit}`,
      column: column.name,
    })),
  ];

  return {
    evaluation,
    sprintEnabled: input.sprintEnabled ?? false,
    sprint: input.sprint ?? null,
    columns,
    workers: workerMetrics,
    alerts,
    risk: {
      people: people.length,
      processes: reviewBacklog.length + stuck.length + orphanBlockers.length,
      escalations: escalations.length,
    },
    riskBreakdown: {
      people: people.map((worker) => ({
        worker_id: worker.id,
        display_name: worker.display_name,
        cognitive_load: worker.cognitive_load,
        attention_risk_score: worker.attention_risk_score ?? 0,
        risk_level: worker.attention_risk_level ?? 'ok',
      })),
      processes: { reviewBacklog, stuck, orphanBlockers },
      escalations,
    },
    cached_at: new Date().toISOString(),
    cache_ttl: { columns: 5, workers: 60, alerts: 60 },
  };
}

