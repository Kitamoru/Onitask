// POST /api/agent/ops/executions/[execution_id]/terminal — Arch 0.9 Ops API (01 §3).
// Fenced agent completion: review | escalate | handoff. Never move_task (INV 4).
// Thin REST wrapper over the shared tool core (also used by MCP dispatch).

import { handleOpsRequest } from '@core/shared/opsTransport';
import { opsTerminalCore } from '@core/shared/opsTools';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (ctx, body) =>
    opsTerminalCore(ctx, execution_id, body)
  );
}
