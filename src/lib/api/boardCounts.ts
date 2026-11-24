/**
 * Board counts API client — BOARD-AGG read model for /boards.
 *
 * Сервер считает агрегаты (counts/riskData/members/sprints) — клиент не тянет
 * сырые задачи ради ~20 чисел. Единый queryKey ['board-counts']:
 * инвалидация из точек мутаций (flowboard) + prefetch после первого лоада.
 */

export interface BoardCountStats {
  inQueue: number;
  inWork: number;
  onReview: number;
  done: number;
}

export interface BoardMemberCounts {
  humans: number;
  agents: number;
}

export interface BoardRiskData {
  people: number;
  processes: number;
  escalations: number;
}

export interface BoardRiskBreakdownPerson {
  worker_id: string;
  workspace_id: string;
  display_name: string;
  cognitive_load: number;
  attention_risk_score: number;
  risk_level: 'ok' | 'warning' | 'critical';
}

export interface BoardRiskBreakdownProcessRow {
  id: string;
  title: string;
  workspace_id: string;
  taskId?: string;
}

export interface BoardRiskBreakdownProcessReviewRow extends BoardRiskBreakdownProcessRow {
  reviewer_id: string;
  reviewer_name: string | null;
  review_count: number;
}

export interface BoardRiskBreakdownProcessStuckRow extends BoardRiskBreakdownProcessRow {
  assigned_to: string | null;
  hours_stuck: number | null;
}

export interface BoardRiskBreakdownProcessOrphanRow extends BoardRiskBreakdownProcessRow {
  hours_blocked: number | null;
}

export interface BoardRiskBreakdownEscalationRow {
  id: string;
  title: string;
  workspace_id: string;
  escalation_reason: string | null;
  assigned_to: string | null;
}

export interface BoardRiskBreakdown {
  people: BoardRiskBreakdownPerson[];
  processes: {
    reviewBacklog: BoardRiskBreakdownProcessReviewRow[];
    stuck: BoardRiskBreakdownProcessStuckRow[];
    orphanBlockers: BoardRiskBreakdownProcessOrphanRow[];
  };
  escalations: BoardRiskBreakdownEscalationRow[];
}

export interface BoardCountsData {
  counts: Record<string, BoardCountStats>;
  members: Record<string, BoardMemberCounts>;
  riskData: BoardRiskData;
  riskBreakdown: BoardRiskBreakdown;
  /** Whether F-01 is enabled per workspace; all false lets UI hide People. */
  cognitiveWeightEnabledByWorkspace: Record<string, boolean>;
  sprintsByWorkspace: Record<string, BoardSprintSummaryLite>;
}

export interface BoardSprintSummaryLite {
  name: string;
  topic: string;
  daysElapsed: number;
  totalDays: number;
  status?: string;
  isActive?: boolean;
}

export interface BoardCountsData {
  counts: Record<string, BoardCountStats>;
  members: Record<string, BoardMemberCounts>;
  riskData: BoardRiskData;
  /** Whether F-01 is enabled per workspace; all false lets UI hide People. */
  cognitiveWeightEnabledByWorkspace: Record<string, boolean>;
  sprintsByWorkspace: Record<string, BoardSprintSummaryLite>;
}

export const BOARD_COUNTS_QUERY_KEY = ['board-counts'] as const;

/** Fetch board aggregates. init_data передаётся явно (TWA auth). */
export async function fetchBoardCounts(initData: string): Promise<BoardCountsData> {
  const res = await fetch('/api/workspaces/board-counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ init_data: initData }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || 'Failed to load board counts');
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to load board counts');
  }
  return json.data as BoardCountsData;
}
