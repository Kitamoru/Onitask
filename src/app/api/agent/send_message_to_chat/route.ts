// POST /api/agent/send_message_to_chat — MCP Contract v0.8.0 §4.6 (REST transport)

import { handleAgentRequest } from '@core/shared/transport';
import { sendMessageToChat } from '@core/domain/agent/sendMessageToChat';

export async function POST(req: Request) {
  return handleAgentRequest(req, 'send_message_to_chat', (ctx, body) =>
    sendMessageToChat({
      key: ctx,
      agentName: ctx.agentName,
      chat_id: body.chat_id as number,
      text: body.text as string,
      parse_mode: body.parse_mode as 'HTML' | 'MarkdownV2' | undefined,
    })
  );
}