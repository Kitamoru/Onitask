// POST /api/agent/get_task_comments — FILE-08 (REST transport)
// Read-only: фид «Комментарии» задачи для duty poll (обёртка над RPC get_task_feed).
// Не пишет agent_events (read-only контур).

import { handleAgentRequest } from '@core/shared/transport';
import { getTaskComments } from '@core/domain/agent/getTaskComments';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'get_task_comments', (ctx, body) =>
    getTaskComments({
      key: ctx,
      agentName: ctx.agentName,
      task_id: body.task_id as string,
      cursor_created: body.cursor_created as string | undefined,
      cursor_id: body.cursor_id as string | undefined,
      limit: body.limit as number | undefined,
    })
  );
}