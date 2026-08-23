// POST /api/agent/escalate_task — MCP Contract v0.8.0 §4.5 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { escalateTask } from '@core/domain/agent/escalateTask';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'escalate_task', (ctx, body) =>
    escalateTask({
      key: ctx,
      agentName: ctx.agentName,
      task_id: body.task_id as string,
      reason: body.reason as
        | 'insufficient_context'
        | 'conflicting_requirements'
        | 'blocked_by'
        | 'out_of_scope',
      suggested_action: body.suggested_action as string | undefined,
    })
  );
}