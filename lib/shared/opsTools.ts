// lib/shared/opsTools.ts
// Arch 0.9 Stage 4 (MCP contract 02): tool cores shared by the Ops REST routes
// (thin wrappers via handleOpsRequest) and the native MCP POST /mcp dispatch
// (parity B: MCP = domain + ops tools). Validation → quota (lease only,
// fail-closed) → ops_* RPC (062). Identity is OpsRequestContext — always
// resolved from the key (INV 9 / ADR R2); body agent_name may only assert.

import {
  requireUuid,
  requireString,
  opsQuota,
  callOpsRpc,
  OpsApiError,
  type OpsRequestContext,
} from './opsTransport';

// ============================================================================
// ops_lease — POST /api/agent/ops/lease (01 §1) / MCP contract 02
// ============================================================================

export async function opsLeaseCore(
  ctx: OpsRequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const runtimeId = requireUuid(body.runtime_id, 'runtime_id');

  // limit: optional, default 1, max 1 (RPC enforces too — validate early for 400)
  if (body.limit !== undefined && body.limit !== 1) {
    throw new OpsApiError(400, 'invalid_request', 'lease limit must be 1 (0.9).');
  }

  await opsQuota(ctx.workspaceId, ctx.agentName);

  return callOpsRpc('ops_lease', {
    p_workspace_id: ctx.workspaceId,
    p_agent_name: ctx.agentName,
    p_runtime_id: runtimeId,
    p_limit: 1,
  });
}

// ============================================================================
// ops_heartbeat — POST …/executions/{id}/heartbeat (01 §2)
// ============================================================================

export async function opsHeartbeatCore(
  _ctx: OpsRequestContext,
  executionId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const execution = requireUuid(executionId, 'execution_id');
  const runtimeId = requireUuid(body.runtime_id, 'runtime_id');

  return callOpsRpc('ops_heartbeat', {
    p_execution_id: execution,
    p_runtime_id: runtimeId,
  });
}

// ============================================================================
// ops_terminal — POST …/executions/{id}/terminal (01 §3)
// Fenced agent completion: review | escalate | handoff. Never move_task (INV 4).
// ============================================================================

const TERMINAL_OUTCOMES = new Set(['review', 'escalate', 'handoff']);

export async function opsTerminalCore(
  _ctx: OpsRequestContext,
  executionId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const execution = requireUuid(executionId, 'execution_id');
  const runtimeId = requireUuid(body.runtime_id, 'runtime_id');
  const taskId = requireUuid(body.task_id, 'task_id');

  if (
    typeof body.task_version !== 'number' ||
    !Number.isInteger(body.task_version)
  ) {
    throw new OpsApiError(400, 'invalid_request', "'task_version' must be an integer.");
  }

  if (typeof body.outcome !== 'string' || !TERMINAL_OUTCOMES.has(body.outcome)) {
    throw new OpsApiError(
      400,
      'invalid_request',
      "'outcome' must be one of: review, escalate, handoff."
    );
  }

  const summary =
    body.summary === undefined || body.summary === null
      ? null
      : requireString(body.summary, 'summary');

  const metadata =
    body.metadata === undefined || body.metadata === null
      ? {}
      : body.metadata;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new OpsApiError(400, 'invalid_request', "'metadata' must be an object.");
  }

  const nextOwner =
    body.next_owner === undefined || body.next_owner === null
      ? null
      : requireString(body.next_owner, 'next_owner');

  return callOpsRpc('ops_terminal', {
    p_execution_id: execution,
    p_runtime_id: runtimeId,
    p_task_id: taskId,
    p_task_version: body.task_version,
    p_outcome: body.outcome,
    p_summary: summary,
    p_metadata: metadata,
    p_next_owner: nextOwner,
  });
}

// ============================================================================
// ops_ack — POST …/executions/{id}/ack (01 §4)
// Strict 0.9: ack requires a preceding ops_terminal (409 terminal_required from RPC).
// ============================================================================

export async function opsAckCore(
  _ctx: OpsRequestContext,
  executionId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const execution = requireUuid(executionId, 'execution_id');
  const runtimeId = requireUuid(body.runtime_id, 'runtime_id');
  const receipt = requireString(body.receipt, 'receipt');

  return callOpsRpc('ops_ack', {
    p_execution_id: execution,
    p_runtime_id: runtimeId,
    p_receipt: receipt,
  });
}

// ============================================================================
// ops_nack — POST …/executions/{id}/nack (01 §4)
// Delivery/accept failure, not business terminal. unsupported_task → escalate;
// otherwise requeue under max_attempts (RPC 062 implements the policy).
// ============================================================================

const NACK_REASONS = new Set([
  'unsupported_task',
  'runtime_busy',
  'dependency_unavailable',
  'transient_error',
  'other',
]);

export async function opsNackCore(
  _ctx: OpsRequestContext,
  executionId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const execution = requireUuid(executionId, 'execution_id');
  const runtimeId = requireUuid(body.runtime_id, 'runtime_id');
  const receipt = requireString(body.receipt, 'receipt');

  if (typeof body.reason !== 'string' || !NACK_REASONS.has(body.reason)) {
    throw new OpsApiError(
      400,
      'invalid_request',
      "'reason' must be one of: unsupported_task, runtime_busy, dependency_unavailable, transient_error, other."
    );
  }

  const detail =
    body.detail === undefined || body.detail === null
      ? null
      : requireString(body.detail, 'detail');

  return callOpsRpc('ops_nack', {
    p_execution_id: execution,
    p_runtime_id: runtimeId,
    p_receipt: receipt,
    p_reason: body.reason,
    p_detail: detail,
  });
}
