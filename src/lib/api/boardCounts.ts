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
