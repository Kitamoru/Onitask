// lib/shared/opsTransport.ts
// Shared plumbing for the Arch 0.9 Ops REST surface (docs/refactor-ai/01 + 06 yaml).
// Base path /api/agent/ops. Pattern per migration 062 G3: Next.js routes are thin —
// auth → body validation → quota (fail-closed) → Postgres RPC → error mapping.
//
// Ops error envelope (yaml ErrorBody): { error: { code, message, details } }
// with STRING codes — deliberately different from the v0.8 DomainError envelope.

import {
  bearerFromHeaders,
  resolveAgentKey,
  getSupabaseClient,
} from './mcpAuth';

// ============================================================================
// Ops error — string code per yaml components.schemas.ErrorBody
// ============================================================================

export class OpsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'OpsApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): { error: { code: string; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

// HTTP matrix — docs/refactor-ai/01_ONITASK_OPS_API_0.9.md §Errors
const OPS_HTTP_STATUS: Record<string, number> = {
  invalid_request: 400,
  invalid_credentials: 401,
  forbidden_workspace: 403,
  agent_not_allowed: 403,
  task_not_found: 404,
  execution_not_found: 404,
  version_conflict: 409,
  stale_claim: 409,
  claim_closed: 409,
  lease_expired: 409,
  terminal_required: 409,
  task_already_claimed: 409,
  invalid_terminal_transition: 422,
  rate_limited: 429,
  internal_error: 500,
  dispatch_unavailable: 503,
  quota_unavailable: 503,
};

function statusForOpsCode(code: string): number {
  return OPS_HTTP_STATUS[code] ?? 500;
}

/** Map an ops RPC error payload { error: { code, message, details } } → OpsApiError. */
export function opsErrorFromRpc(payload: unknown): OpsApiError {
  const err =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error: { code?: string; message?: string; details?: Record<string, unknown> } }).error
      : null;
  const code = err?.code ?? 'internal_error';
  return new OpsApiError(
    statusForOpsCode(code),
    code,
    err?.message ?? 'Ops RPC failed.',
    err?.details ?? {}
  );
}

// ============================================================================
// Validation helpers (invalid_request = 400)
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new OpsApiError(400, 'invalid_request', `'${field}' must be a UUID.`);
  }
  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OpsApiError(400, 'invalid_request', `'${field}' is required.`);
  }
  return value;
}

// ============================================================================
// Auth — identity from key only (INV 9, ADR R2); body fields may only assert
// ============================================================================

export interface OpsRequestContext {
  workspaceId: string;
  agentName: string;
}

export async function assertOpsRequest(opts: {
  rawKey: string | null;
  body: Record<string, unknown>;
}): Promise<OpsRequestContext> {
  if (!opts.rawKey) {
    throw new OpsApiError(401, 'invalid_credentials', 'Provide Authorization: Bearer <key>.');
  }
  const key = await resolveAgentKey(opts.rawKey);

  // Tenant isolation (A-7): optional body.workspace_id must match key scope
  if (opts.body.workspace_id !== undefined && opts.body.workspace_id !== key.workspaceId) {
    throw new OpsApiError(403, 'forbidden_workspace', 'workspace_id does not match the key scope.');
  }

  // INV 9: body agent_name, when present, must equal the key identity
  if (opts.body.agent_name !== undefined && opts.body.agent_name !== key.keyAgentName) {
    throw new OpsApiError(403, 'agent_not_allowed', 'agent_name does not match the key identity.');
  }

  return { workspaceId: key.workspaceId, agentName: key.keyAgentName };
}

// ============================================================================
// Quota — fail-closed (INV 10): RPC failure → 503, exhausted → 429
// Applied to lease (the work unit); heartbeat/ack/terminal are not billed.
// ============================================================================

export async function opsQuota(workspaceId: string, agentName: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('check_and_decrement_quota', {
      p_workspace_id: workspaceId,
      p_agent_name: agentName,
      p_cost: 1,
    });
    if (error) {
      console.error('Ops quota RPC error:', error);
      throw new OpsApiError(503, 'quota_unavailable', 'Quota check failed; ops mutation rejected (fail-closed).');
    }
    if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
      throw new OpsApiError(429, 'rate_limited', 'AI mutation quota exhausted. Retry after quota reset.');
    }
  } catch (err) {
    if (err instanceof OpsApiError) throw err;
    console.error('Ops quota unexpected failure:', err);
    throw new OpsApiError(503, 'quota_unavailable', 'Quota check failed; ops mutation rejected (fail-closed).');
  }
}

// ============================================================================
// RPC call — jsonb payload; { error: {...} } → OpsApiError with mapped status
// ============================================================================

export async function callOpsRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    const supabase = getSupabaseClient();
    const res = await supabase.rpc(fn, args);
    if (res.error) {
      console.error(`Ops RPC ${fn} error:`, res.error);
      throw new OpsApiError(503, 'dispatch_unavailable', `Ops RPC '${fn}' failed.`);
    }
    data = res.data;
  } catch (err) {
    if (err instanceof OpsApiError) throw err;
    console.error(`Ops RPC ${fn} unexpected failure:`, err);
    throw new OpsApiError(503, 'dispatch_unavailable', `Ops RPC '${fn}' failed.`);
  }

  if (data && typeof data === 'object' && 'error' in (data as object)) {
    throw opsErrorFromRpc(data);
  }
  return (data ?? {}) as Record<string, unknown>;
}

// ============================================================================
// Route wrapper — thin handler serialization with the ops error envelope
// ============================================================================

export async function handleOpsRequest(
  req: Request,
  handler: (
    ctx: OpsRequestContext,
    body: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
): Promise<Response> {
  try {
    const rawKey = bearerFromHeaders(req.headers);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      throw new OpsApiError(400, 'invalid_request', 'Request body must be JSON.');
    }

    const ctx = await assertOpsRequest({ rawKey, body });
    const result = await handler(ctx, body);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof OpsApiError) {
      return Response.json(err.toBody(), { status: err.status });
    }
    console.error('Ops route unexpected error:', err);
    const fallback = new OpsApiError(500, 'internal_error', 'Internal server error.');
    return Response.json(fallback.toBody(), { status: fallback.status });
  }
}

