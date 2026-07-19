// useTeamMetrics hook — Team Tab: velocity, escalations, risk signals
// Fetches aggregated team metrics for the current workspace

export interface TeamMetrics {
  velocity: number;
  escalations: number;
  highRiskMembers: number;
  activeAgents: number;
}

export function useTeamMetrics(workspaceId?: string) {
  const metrics: TeamMetrics | null = null;
  const isLoading = false;

  return {
    metrics,
    isLoading,
    refresh: async () => {},
  };
}