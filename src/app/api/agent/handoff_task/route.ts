// POST /api/agent/handoff_task — MCP Contract v0.8.0 §4.8 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { handoffTask } from '@core/domain/agent/handoffTask';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'handoff_task', (ctx, body) =>
    handoffTask({
      key: ctx,
      agentName: ctx.agentName,
      task_id: body.task_id as string,
      target_agent: body.target_agent as string,
      handoff_notes: body.handoff_notes as string,
      move_to_column: body.move_to_column as
        | 'backlog'
        | 'in_progress'
        | 'review'
        | 'done'
        | undefined,
    })
  );
}