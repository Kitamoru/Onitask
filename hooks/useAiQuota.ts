// useAiQuota hook — GET /api/ai/quota
// Displays and manages AI token quota for current workspace

export function useAiQuota(workspaceId?: string) {
  const remainingTokens = 0;
  const totalTokens = 0;
  const isLoading = false;

  return {
    remainingTokens,
    totalTokens,
    isLoading,
    refresh: async () => {},
  };
}