// POST /api/agent/ops/lease — Arch 0.9 Ops API (01 §1).
// Thin REST wrapper over the shared tool core (also used by MCP dispatch).

import { handleOpsRequest } from '@core/shared/opsTransport';
import { opsLeaseCore } from '@core/shared/opsTools';

export async function POST(req: Request) {
  return handleOpsRequest(req, async (ctx, body) => opsLeaseCore(ctx, body));
}
