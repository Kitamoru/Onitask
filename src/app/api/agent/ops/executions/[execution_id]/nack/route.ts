// POST /api/agent/ops/executions/[execution_id]/nack — Arch 0.9 Ops API (01 §4).
// Delivery/accept failure, not business terminal. unsupported_task → escalate;
// otherwise requeue under max_attempts (RPC 062 implements the policy).
// Thin REST wrapper over the shared tool core (also used by MCP dispatch).

import { handleOpsRequest } from '@core/shared/opsTransport';
import { opsNackCore } from '@core/shared/opsTools';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (ctx, body) =>
    opsNackCore(ctx, execution_id, body)
  );
}
