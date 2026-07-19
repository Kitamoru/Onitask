/**
 * FlowBoard TypeScript interfaces.
 * 
 * These types define the contracts between the frontend FlowBoard component
 * and the backend API routes / Edge Functions.
 * 
 * Based on: docs/onitask_flow_.md §9–10, §19–22
 */

// ─── Sprint ──────────────────────────────────────────────────────────────────

export interface SprintInfo {
  /** Sprint UUID */
  id: string;
  /** Display name, e.g. "Sprint 3 — Auth & MCP" */
  name: string;
  /** Short topic label */
  topic: string;
  /** Start date ISO string or display string */
  startDate: string;
  /** End date ISO string or display string */
  endDate: string;
  /** Days elapsed since sprint start */
  daysElapsed: number;
  /** Total sprint duration in days */
  totalDays: number;
  /** Progress percentage 0–100 */
  progress: number;
  /** Completed story points */
  doneSP: number;
  /** Total story points planned */
  totalSP: number;
  /** Tasks currently in in_progress column assigned to this sprint */
  inProgress: number;
  /** Tasks currently in review column assigned to this sprint */
  onReview: number;
  /** Whether the sprint is active */
  isActive: boolean;
}

// ─── Signals (Risk Pulse) ────────────────────────────────────────────────────

export interface SignalData {
  /** Unique signal identifier */
  id: string;
  /** Signal label: "Люди", "Процессы", "Эскалации" */
  label: string;
  /** Count of issues for this signal */
  count: number;
  /** Human-readable description */
  description: string;
}

// ─── Task Status Cards ───────────────────────────────────────────────────────

export interface TaskStatusData {
  /** Unique status identifier */
  id: string;
  /** Status label: "Активные", "В очереди", "На проверке", "Сделано" */
  label: string;
  /** Number of tasks in this status */
  count: number;
  /** Number of filled shape indicators */
  shapes: number;
  /** Maximum number of shape indicators */
  maxShapes: number;
  /** CSS color token or hex for shape fill */
  color: string;
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

export interface AgentCardData {
  /** Agent UUID */
  id: string;
  /** Agent name */
  name: string;
  /** Cognitive weight (0–3 scale) */
  cognitiveWeight: number;
  /** Story points per day velocity */
  spPerDay: number;
  /** Trend direction indicator */
  trendUp: boolean;
  /** Active days count */
  activeDays: number;
  /** Role label */
  roleLabel: string;
  /** Whether agent is overloaded */
  overloaded?: boolean;
  /** List of active task references */
  tasks: string[];
}

// ─── Worker Card ─────────────────────────────────────────────────────────────

export interface WorkerCardData {
  /** Worker UUID */
  id: string;
  /** Display name */
  displayName: string;
  /** Optional avatar URL */
  avatarUrl?: string;
  /** Cognitive weight (0–3 scale) */
  cognitiveWeight: number;
  /** Story points per day velocity */
  spPerDay: number;
  /** Trend direction indicator */
  trendUp: boolean;
  /** Active days count */
  activeDays: number;
  /** Role label, e.g. "🎪 Лидер команды" */
  roleLabel: string;
  /** Whether worker is overloaded */
  overloaded?: boolean;
  /** List of active task references */
  tasks: string[];
  /** Worker type: human or AI agent */
  type: 'human' | 'agent';
}

// ─── Flow Board Props ────────────────────────────────────────────────────────

export interface FlowBoardProps {
  /** Page title override */
  title?: string;
  /** Current date display */
  currentDate?: string;
  /** Active sprint info */
  sprint?: SprintInfo;
  /** Risk pulse signals */
  signals: SignalData[];
  /** Task status cards */
  taskStatuses: TaskStatusData[];
  /** Team members (humans + agents) */
  workers: WorkerCardData[];
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string | null;
  /** Callback for add colleague button */
  onAddWorker?: () => void;
  /** Callback for add agent button */
  onAddAgent?: () => void;
  /** Callback for refreshing data */
  onRefresh?: () => void;
}

// ─── API Response Types ──────────────────────────────────────────────────────

/** Response from GET /api/flow/metrics Edge Function */
export interface FlowMetricsResponse {
  /** Sprint information */
  sprint: SprintInfo | null;
  /** Column health WIP data */
  columns: ColumnHealthData[];
  /** Worker load data */
  workers: WorkerMetricData[];
  /** Alerts / anomalies */
  alerts: AlertData[];
  /** Cache timestamp */
  cached_at: string;
  /** Cache TTL configuration */
  cache_ttl: {
    columns: number;
    workers: number;
    alerts: number;
  };
}

/** Column health WIP data */
export interface ColumnHealthData {
  /** Column name: backlog, in_progress, review, done */
  name: string;
  /** Current WIP count */
  wip_current: number;
  /** WIP limit (null for done) */
  wip_limit: number | null;
  /** Health status: green, yellow, red */
  health: 'green' | 'yellow' | 'red';
  /** Average cycle time in hours */
  avg_cycle_time_hours: number | null;
}

/** Worker metric data */
export interface WorkerMetricData {
  /** Worker display name */
  display_name: string;
  /** Worker type: human or agent */
  type: 'human' | 'agent';
  /** Cognitive load (0–3 scale) */
  cognitive_load: number;
  /** Overload threshold */
  overload_threshold: number;
  /** Status: ok, overloaded */
  status: 'ok' | 'overloaded';
  /** Throughput for agents (tasks/day) */
  throughput?: number;
  /** Pending escalations count for agents */
  pending_escalations?: number;
}

/** Alert / anomaly data */
export interface AlertData {
  /** Alert type: overloaded_member, bottleneck, stuck_in_column, etc. */
  type: string;
  /** Severity: low, medium, high */
  severity: 'low' | 'medium' | 'high';
  /** Alert message */
  message: string;
  /** Optional column name (for bottleneck alerts) */
  column?: string;
  /** Optional task ID (for stuck_in_column alerts) */
  task_id?: string;
  /** Optional stuck duration in hours */
  stuck_since_hours?: number;
}

// ─── Task Types ──────────────────────────────────────────────────────────────

/** Task entity from tasks table */
export interface TaskEntity {
  /** Task UUID */
  id: string;
  /** Full task ID, e.g. "ALPHA-45" */
  full_id: string;
  /** Workspace prefix, e.g. "ALPHA" */
  workspace_prefix: string;
  /** Task number within workspace */
  task_number: number;
  /** Title */
  title: string;
  /** Description */
  description: string | null;
  /** Tags array */
  tags: string[];
  /** AI-generated hint */
  ai_hint: string | null;
  /** Column: backlog, in_progress, review, done */
  column: string;
  /** Priority: low, medium, high, critical */
  priority: string;
  /** Deadline ISO string or null */
  deadline: string | null;
  /** Deadline urgency level */
  deadline_urgency: string | null;
  /** Whether task is an inbox draft */
  is_inbox: boolean;
  /** Whether task is blocked */
  is_blocked: boolean;
  /** Whether task needs human intervention */
  needs_human: boolean;
  /** Escalation reason */
  escalation_reason: string | null;
  /** Assigned worker UUID */
  assigned_to: string | null;
  /** Reviewer worker UUID */
  reviewer_id: string | null;
  /** Handoff target worker UUID */
  handoff_to: string | null;
  /** Handoff notes */
  handoff_notes: string | null;
  /** Sprint UUID */
  sprint_id: string | null;
  /** Story points */
  story_points: number | null;
  /** Cognitive weight (0-3) */
  cognitive_weight: number;
  /** Raw natural language input */
  raw_input: string | null;
  /** Clarity score (0-1) */
  clarity_score: number | null;
  /** Complexity (1-3) */
  complexity: number | null;
  /** Enrichment strategy */
  enrichment_strategy: string | null;
  /** Version for optimistic locking */
  version: number;
  /** Drag position within column */
  position: number;
  /** Source of task creation */
  source: string | null;
  /** Additional metadata JSON */
  metadata: Record<string, unknown>;
  /** Created at ISO string */
  created_at: string;
  /** Updated at ISO string */
  updated_at: string;
  /** Moved to current column at ISO string */
  moved_to_column_at: string | null;
}

/** Request body for PATCH /api/tasks/:id */
export interface PatchTaskRequest {
  /** New column value */
  column?: string;
  /** New assignee UUID */
  assigned_to?: string | null;
  /** New reviewer UUID */
  reviewer_id?: string | null;
  /** New priority */
  priority?: string;
  /** New story points */
  story_points?: number | null;
  /** New cognitive weight */
  cognitive_weight?: number;
  /** New deadline */
  deadline?: string | null;
  /** New title */
  title?: string;
  /** New description */
  description?: string | null;
  /** New tags */
  tags?: string[];
  /** Expected version for optimistic lock */
  expected_version?: number;
  /** Whether to clear is_blocked flag */
  clear_blocked?: boolean;
  /** New position for drag-and-drop ordering */
  position?: number;
}

/** Response from PATCH /api/tasks/:id */
export interface PatchTaskResponse {
  task: TaskEntity;
  /** IDs of unblocked tasks (from cascade_unblock) */
  unblocked_ids?: string[];
  /** Warning message if version mismatch */
  warning?: string;
}