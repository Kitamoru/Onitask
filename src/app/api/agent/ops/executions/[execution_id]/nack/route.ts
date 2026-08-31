// POST /api/agent/ops/executions/[execution_id]/nack — Arch 0.9 Ops API (01 §4).
// Delivery/accept failure, not business terminal. unsupported_task → escalate;
// otherwise requeue under max_attempts (RPC 062 implements the policy).

import {
  handleOpsRequest,
  requireUuid,
  requireString,
  callOpsRpc,
  OpsApiError,
} from '@core/shared/opsTransport';

const REASONS = new Set([
  'unsupported_task',
  'runtime_busy',
  'dependency_unavailable',
  'transient_error',
  'other',
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (_ctx, body) => {
    const executionId = requireUuid(execution_id, 'execution_id');
    const runtimeId = requireUuid(body.runtime_id, 'runtime_id');
    const receipt = requireString(body.receipt, 'receipt');

    if (typeof body.reason !== 'string' || !REASONS.has(body.reason)) {
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
      p_execution_id: executionId,
      p_runtime_id: runtimeId,
      p_receipt: receipt,
      p_reason: body.reason,
      p_detail: detail,
    });
  });
}
