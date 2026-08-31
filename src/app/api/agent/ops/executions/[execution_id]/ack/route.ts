// POST /api/agent/ops/executions/[execution_id]/ack — Arch 0.9 Ops API (01 §4).
// Strict 0.9: ack requires a preceding ops_terminal (409 terminal_required from RPC).

import {
  handleOpsRequest,
  requireUuid,
  requireString,
  callOpsRpc,
} from '@core/shared/opsTransport';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (_ctx, body) => {
    const executionId = requireUuid(execution_id, 'execution_id');
    const runtimeId = requireUuid(body.runtime_id, 'runtime_id');
    const receipt = requireString(body.receipt, 'receipt');

    return callOpsRpc('ops_ack', {
      p_execution_id: executionId,
      p_runtime_id: runtimeId,
      p_receipt: receipt,
    });
  });
}
