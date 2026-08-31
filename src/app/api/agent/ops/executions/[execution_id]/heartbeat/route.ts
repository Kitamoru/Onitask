// POST /api/agent/ops/executions/[execution_id]/heartbeat — Arch 0.9 Ops API (01 §2).
// Thin REST wrapper over the shared tool core (also used by MCP dispatch).

import { handleOpsRequest } from '@core/shared/opsTransport';
import { opsHeartbeatCore } from '@core/shared/opsTools';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (ctx, body) =>
    opsHeartbeatCore(ctx, execution_id, body)
  );
}
