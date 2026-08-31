// POST /api/agent/ops/lease — Arch 0.9 Ops API (docs/refactor-ai/01 §1).
// Thin route: auth → validate → quota (fail-closed) → ops_lease RPC (062).

import {
  handleOpsRequest,
  requireUuid,
  opsQuota,
  callOpsRpc,
  OpsApiError,
} from '@core/shared/opsTransport';

export async function POST(req: Request) {
  return handleOpsRequest(req, async (ctx, body) => {
    const runtimeId = requireUuid(body.runtime_id, 'runtime_id');

    // limit: optional, default 1, max 1 (RPC enforces too — validate early for 400)
    if (body.limit !== undefined) {
      if (body.limit !== 1) {
        throw new OpsApiError(400, 'invalid_request', 'lease limit must be 1 (0.9).');
      }
    }

    await opsQuota(ctx.workspaceId, ctx.agentName);

    return callOpsRpc('ops_lease', {
      p_workspace_id: ctx.workspaceId,
      p_agent_name: ctx.agentName,
      p_runtime_id: runtimeId,
      p_limit: 1,
    });
  });
}
