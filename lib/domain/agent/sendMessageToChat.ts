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
import {
  validateAttachments,
  AttachmentValidationError,
} from '../../shared/attachments';
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

  // FILE-03: валидация attached файлов (whitelist + magic bytes + лимиты)
  let attachments: Array<{
    filename: string;
    content_base64: string;
    caption?: string;
  }> = [];
  if (params.attachments !== undefined && params.attachments !== null) {
    try {
      attachments = validateAttachments(params.attachments);
    } catch (err) {
      if (err instanceof AttachmentValidationError) {
        throw invalidParams(err.message);
      }
      throw err;
    }
  }

  // FILE-03: task_id → full_id для inline-кнопки (глубокой ссылки на комментарии)
  let metadata: Record<string, unknown> = {};
  if (params.task_id) {
    const { data: task } = await supabase
      .from('tasks')
      .select('full_id')
      .eq('workspace_id', workspaceId)
      .eq('id', params.task_id)
      .maybeSingle();
    if (!task) {
      throw invalidParams('task_id does not belong to this workspace.');
    }
    metadata = {
      task_id: params.task_id,
      full_id: task.full_id as string,
    };
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

  // Async delivery via queue (bot-notify consumer drains pending rows).
  // FILE-03: attachments уезжают строкой очереди (транзитный outbox, GC 7д),
  // metadata — для inline-кнопки.
  const { data: queued, error: queueError } = await supabase
    .from('telegram_message_queue')
    .insert({
      workspace_id: workspaceId,
      telegram_chat_id: String(params.chat_id),
      message: sanitized.slice(0, 4000), // queue CHECK constraint
      source_agent: agentName,
      priority: 'normal',
      attachments,
      metadata,
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
    params.task_id ?? null,
    `Sent message to chat ${params.chat_id}`,
    {
      chat_id: params.chat_id,
      text_length: sanitized.length,
      attachment_count: attachments.length,
      queue_id: queued.id,
      task_id: params.task_id ?? null,
    },
    null
  );

  // message_id is assigned by Telegram on async delivery; 0 = queued
  return { success: true, message_id: 0 };
}