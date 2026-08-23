// POST /api/agent/create_task — MCP Contract v0.8.0 §4.3 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { createTask } from '@core/domain/agent/createTask';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'create_task', (ctx, body) =>
    createTask({
      key: ctx,
      agentName: ctx.agentName,
      title: body.title as string,
      description: body.description as string | undefined,
      column: body.column as 'backlog' | 'in_progress' | 'review' | undefined,
      assignee: body.assignee as string | undefined,
      tags: body.tags as string[] | undefined,
      deadline: body.deadline as string | undefined,
      priority: body.priority as
        | 'low'
        | 'medium'
        | 'high'
        | 'critical'
        | undefined,
      complexity: body.complexity as 1 | 2 | 3 | undefined,
      blocked_by: body.blocked_by as string | undefined,
    })
  );
}