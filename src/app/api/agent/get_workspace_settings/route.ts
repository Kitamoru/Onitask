// POST /api/agent/get_workspace_settings — MCP Contract v0.8.0 §4.2 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { getWorkspaceSettings } from '@core/domain/agent/getWorkspaceSettings';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'get_workspace_settings', (ctx) =>
    getWorkspaceSettings({
      key: ctx,
      agentName: ctx.agentName,
    })
  );
}