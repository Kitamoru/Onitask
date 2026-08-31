// POST /api/agent/ops/executions/[execution_id]/heartbeat — Arch 0.9 Ops API (01 §2).

import {
  handleOpsRequest,
  requireUuid,
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

    return callOpsRpc('ops_heartbeat', {
      p_execution_id: executionId,
      p_runtime_id: runtimeId,
    });
  });
}
