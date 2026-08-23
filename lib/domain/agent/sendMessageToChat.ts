// lib/domain/agent/sendMessageToChat.ts
// MCP Contract v0.8.0 §4.6.
// Security: chat must belong to workspace; can_send_messages flag;
// sanitizeOutput(text, 'tg') whitelist. Delivery is async via
// telegram_message_queue (migration 024) — separate light limit, no AI quota.

import {
  getSupabaseClient,
  sanitizeOutput,
  logAgentEvent,
} from '../../shared/mcpAuth';
import {
  invalidParams,
  forbidden,
  internalError,
} from '../../shared/errors';
import type {
  SendMessageToChatParams,
  SendMessageToChatResult,
  DomainResult,
} from '../../shared/types';

export async function sendMessageToChat(
  params: SendMessageToChatParams
): Promise<DomainResult<SendMessageToChatResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  if (!params.chat_id || typeof params.chat_id !== 'number') {
    throw invalidParams('chat_id is required (number).');
  }
  if (!params.text || typeof params.text !== 'string') {
    throw invalidParams('text is required.');
  }
  if (params.text.length > 4096) {
    throw invalidParams('text must be at most 4096 characters.');
  }

  // can_send_messages flag from the key (contract §4.6)
  if (!key.canSendMessages) {
    throw forbidden(
      "Tool 'send_message_to_chat' is disabled for this API key (can_send_messages=false)."
    );
  }

  // chat_id must belong to this workspace (tenant isolation, A-7)
  const { data: chat } = await supabase
    .from('workspace_telegram_chats')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('telegram_chat_id', String(params.chat_id))
    .maybeSingle();

  if (!chat) {
    throw forbidden('chat_id does not belong to this workspace.');
  }

  // Sanitize for Telegram HTML (whitelist <b><i><u><s><code><pre>, no <a href>)
  const sanitized = sanitizeOutput(params.text, 'tg');

  // Async delivery via queue (bot-notify infra picks up pending rows)
  const { data: queued, error: queueError } = await supabase
    .from('telegram_message_queue')
    .insert({
      workspace_id: workspaceId,
      telegram_chat_id: String(params.chat_id),
      message: sanitized.slice(0, 4000), // queue CHECK constraint
      source_agent: agentName,
      priority: 'normal',
    })
    .select('id')
    .single();

  if (queueError || !queued) {
    console.error('Telegram queue insert error:', queueError);
    throw internalError('Failed to queue message.');
  }

  // Audit trail
  await logAgentEvent(
    workspaceId,
    agentName,
    'send_message_to_chat',
    null,
    `Sent message to chat ${params.chat_id}`,
    {
      chat_id: params.chat_id,
      text_length: sanitized.length,
      queue_id: queued.id,
    },
    null
  );

  // message_id is assigned by Telegram on async delivery; 0 = queued
  return { success: true, message_id: 0 };
}