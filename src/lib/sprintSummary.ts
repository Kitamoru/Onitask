/**
 * Sprint summary for BoardCard on /boards — shared by
 * /api/workspaces/my-data (full load) and /api/workspaces/board-counts.
 */

export type BoardSprintSummary = {
  name: string;
  topic: string;
  daysElapsed: number;
  totalDays: number;
  status?: string;
  isActive?: boolean;
};

type SprintsRowMinimal = {
  workspace_id: string | null;
  name: string | null;
  goal: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
};

/**
 * По каждому workspace — последний active/planning спринт
 * (строки уже отсортированы по created_at desc).
 */
export function buildSprintsByWorkspace(
  sprints: SprintsRowMinimal[],
): Record<string, BoardSprintSummary> {
  const byWs = new Map<string, SprintsRowMinimal>();

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
      status: sp.status ?? undefined,
      isActive: sp.status === 'active',
    };
  }

  return result;
}
