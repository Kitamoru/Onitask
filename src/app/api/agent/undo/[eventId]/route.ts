// POST /api/agent/undo/[eventId] — MCP Contract v0.8.0 §4.9 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { undo } from '@core/domain/agent/undo';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  return handleAgentRequest(req, 'undo', (ctx) =>
    undo({
      key: ctx,
      agentName: ctx.agentName,
      event_id: eventId,
    })
  );
}