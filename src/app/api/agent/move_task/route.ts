// POST /api/agent/move_task — MCP Contract v0.8.0 §4.4 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { moveTask } from '@core/domain/agent/moveTask';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'move_task', (ctx, body) =>
    moveTask({
      key: ctx,
      agentName: ctx.agentName,
      task_id: body.task_id as string,
      target_column: body.target_column as
        | 'backlog'
        | 'in_progress'
        | 'review'
        | 'done',
      version: body.version as number,
      claim: body.claim as boolean | undefined,
      reason: body.reason as string | undefined,
    })
  );
}