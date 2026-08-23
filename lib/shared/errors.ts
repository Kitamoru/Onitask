// lib/shared/errors.ts
// Domain error envelope per MCP Contract v0.8.0 §6.
// Used by both transports (REST /api/agent/* and native MCP POST /mcp).

export interface DomainErrorBody {
  code: number;
  type: string;
  message: string;
}

/**
 * DomainError carries an HTTP-compatible code and a stable `type`
 * from the contract §6 error matrix. Both transports serialize it
 * into the same envelope: { error: { code, type, message } }.
 */
export class DomainError extends Error {
  readonly code: number;
  readonly type: string;

  constructor(code: number, type: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.type = type;
  }

  toBody(): DomainErrorBody {
    return { code: this.code, type: this.type, message: this.message };
  }
}

// ============================================================================
// Factory helpers — one per contract §6 row used by the agent surface
// ============================================================================

export const unauthorized = (message = 'Missing, invalid or revoked API key.') =>
  new DomainError(401, 'unauthorized', message);

export const forbidden = (message = 'workspace_id does not match the key scope.') =>
  new DomainError(403, 'forbidden', message);

export const toolNotPermitted = (toolName: string) =>
  new DomainError(
    403,
    'tool_not_permitted',
    `Tool '${toolName}' is not in allowed_tools for this API key.`
  );

export const invalidParams = (message: string) =>
  new DomainError(400, 'invalid_params', message);

export const taskNotFound = () =>
  new DomainError(404, 'task_not_found', 'Task not found in this workspace.');

export const workerNotFound = (agentName: string) =>
  new DomainError(
    404,
    'worker_not_found',
    `Worker "${agentName}" not found or inactive in this workspace.`
  );

export const blockerNotFound = () =>
  new DomainError(
    404,
    'blocker_not_found',
    'Task specified in blocked_by does not exist in this workspace.'
  );

export const versionConflict = () =>
  new DomainError(
    409,
    'version_conflict',
    'Task was modified by another client. Refetch and retry.'
  );

export const alreadyClaimed = () =>
  new DomainError(
    409,
    'already_claimed',
    'Task is already claimed by another assignee.'
  );

export const circularDependency = () =>
  new DomainError(
    409,
    'circular_dependency',
    'blocked_by creates a dependency cycle. Task cannot block itself transitively.'
  );

export const quotaExceeded = () =>
  new DomainError(
    422,
    'quota_exceeded',
    'AI mutation quota exhausted. Use send_message_to_chat (separate light limit) or wait for quota reset.'
  );

export const rateLimited = (retryAfterSeconds: number) =>
  new DomainError(
    429,
    'rate_limited',
    `Infrastructure rate limit hit. Retry after ${retryAfterSeconds}s.`
  );

export const taskCreationRateLimit = (maxPerMinute: number) =>
  new DomainError(
    429,
    'task_creation_rate_limit',
    `Rate limit exceeded: max ${maxPerMinute} tasks/min per agent. Retry after 60s.`
  );

export const internalError = (message = 'Internal server error.') =>
  new DomainError(500, 'internal_error', message);

/**
 * Normalize any thrown value into a DomainError.
 */
export function toDomainError(err: unknown): DomainError {
  if (err instanceof DomainError) return err;
  if (err instanceof Error) return internalError(err.message);
  return internalError(String(err));
}