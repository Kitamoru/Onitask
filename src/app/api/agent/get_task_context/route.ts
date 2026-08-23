// POST /api/agent/get_task_context — MCP Contract v0.8.0 §4.7 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { getTaskContext } from '@core/domain/agent/getTaskContext';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'get_task_context', (ctx, body) =>
    getTaskContext({
      key: ctx,
      agentName: ctx.agentName,
      task_id: body.task_id as string,
    })
  );
}