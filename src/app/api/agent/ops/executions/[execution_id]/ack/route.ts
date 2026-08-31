// POST /api/agent/ops/executions/[execution_id]/ack — Arch 0.9 Ops API (01 §4).
// Strict 0.9: ack requires a preceding ops_terminal (409 terminal_required from RPC).
// Thin REST wrapper over the shared tool core (also used by MCP dispatch).

import { handleOpsRequest } from '@core/shared/opsTransport';
import { opsAckCore } from '@core/shared/opsTools';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (ctx, body) =>
    opsAckCore(ctx, execution_id, body)
  );
}
