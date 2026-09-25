export interface WorkspaceWorkerIdentity {
  id: string;
  workspace_id: string;
  source_id: string;
  type: string;
}

/**
 * Resolve the current user's worker for the active workspace.
 *
 * A user has one worker row per workspace, so authData.worker.id is only valid
 * for the workspace selected during init. Stream must use the active workspace
 * row instead; otherwise cognitive load looks up a worker from another board.
 */
export function findActiveWorkspaceWorkerId(
  workers: readonly WorkspaceWorkerIdentity[],
  profileId: string | undefined,
  activeWorkspaceId: string | null | undefined,
  fallbackWorkerId?: string,
): string | undefined {
  if (!profileId || !activeWorkspaceId) return fallbackWorkerId;
  return workers.find((worker) =>
    worker.type === 'human'
    && worker.workspace_id === activeWorkspaceId
    && worker.source_id === profileId,
  )?.id ?? fallbackWorkerId;
}
