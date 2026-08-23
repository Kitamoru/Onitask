// POST /api/agent/get_tasks_by_column — MCP Contract v0.8.0 §4.6 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { getTasksByColumn } from '@core/domain/agent/getTasksByColumn';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'get_tasks_by_column', (ctx, body) =>
    getTasksByColumn({
      key: ctx,
      agentName: ctx.agentName,
    })
  );
}