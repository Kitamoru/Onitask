// src/lib/bot/commands.ts — Команды бота (v0.6.5 spec)
// BOT-01: /create-task [text|voice] — создание задачи через F-04 pipeline
// BOT-02: /run-task FULL_ID — просмотр задачи по full_id (ALPHA-123)
// BOT-03: /help — справка
//
// Reactions: 👀 при начале обработки, ✅ при успехе, ❌ при ошибке
// Progress messages отправляются через sendChatAction('typing')

import { createClient } from '@supabase/supabase-js';
import {
  sendRichMessage,
  sendChatAction,
  setMessageReaction,
  buildTaskCardHTML,
  escapeHtml,
} from '../../../lib/bot';
import { handleTextTask, handleVoiceTask } from './taskHandler';
import type { Message } from '../../../types/telegram';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_MESSAGE_LENGTH = 4096;

// ============================================================================
// Command Router (v0.6.5: /create-task, /run-task, /help only)
// ============================================================================

/**
 * Commands that require workspace selection before execution.
 */
export const COMMANDS_REQUIRING_WORKSPACE = ['create-task'];

/**
 * Commands that work WITHOUT workspace (start, help).
 */
export const WORKSPACE_FREE_COMMANDS = ['start', 'help'];

/**
 * Route a command message to the appropriate handler.
 * Returns { handled: true } if command was processed, { handled: false } otherwise.
 */
export async function handleCommand(
  msg: Message,
  command: string,
  args: string,
  workspaceId: string
): Promise<{ handled: boolean }> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  const messageId = msg.message_id;

  switch (command) {
    case 'create-task':
      // Order matters per spec §5.2: text/voice BEFORE lookup parse
      if (msg.voice || msg.audio) {
        // Voice: /create-task 🎤
        await handleVoiceTaskWithReaction(msg, workspaceId, messageId);
      } else if (args && /^[A-Z]+-\d+$/.test(args)) {
        // Mistake: user used /create-task ALPHA-123 — redirect to /run-task
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: { html: `🔍 Для просмотра задачи используйте <b>/run-task ${escapeHtml(args)}</b>` },
        });
        await setMessageReaction(BOT_TOKEN!, chatId, messageId, '❌').catch(() => {});
      } else if (args) {
        // Text: /create-task <description>
        await handleTextTaskWithReaction(msg, args, workspaceId, messageId);
      } else {
        // No args — show usage hint
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: { html: '📝 Пришлите текст или голосовое сообщение для создания задачи.\nИли введите /run-task TASK-123 для просмотра задачи.' },
        });
      }
      return { handled: true };

    case 'run-task':
      // /run-task TASK-123 — Lookup задачи по номеру (§5.3)
      if (args && /^[A-Z]+-\d+$/.test(args)) {
        await handleTaskLookupWithReaction(chatId, args, messageId, msg.message_thread_id);
      } else {
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: { html: '📝 Введите полный ID задачи, например: <b>/run-task ALPHA-123</b>' },
        });
      }
      return { handled: true };

    case 'help':
      await handleHelp(chatId);
      return { handled: true };

    default:
      return { handled: false };
  }
}

// ============================================================================
// Wrapper functions with reactions
// ============================================================================

/**
 * Handle text task with 👀 reaction at start.
 */
async function handleTextTaskWithReaction(
  msg: Message,
  text: string,
  workspaceId: string,
  messageId: number
): Promise<void> {
  const chatId = msg.chat.id;
  // Reaction 👀 at start
  await setMessageReaction(BOT_TOKEN!, chatId, messageId, '👀').catch(() => {});
  // Typing indicator for progress
  await sendChatAction(BOT_TOKEN!, { chat_id: chatId, action: 'typing' }).catch(() => {});
  await handleTextTask(msg, text, workspaceId);
  // Reaction ✅ will be set inside handleTextTask on success, or ❌ on error
}

/**
 * Handle voice task with 👀 reaction at start.
 */
async function handleVoiceTaskWithReaction(
  msg: Message,
  workspaceId: string,
  messageId: number
): Promise<void> {
  const chatId = msg.chat.id;
  // Reaction 👀 at start
  await setMessageReaction(BOT_TOKEN!, chatId, messageId, '👀').catch(() => {});
  // Typing indicator for progress
  await sendChatAction(BOT_TOKEN!, { chat_id: chatId, action: 'typing' }).catch(() => {});
  await handleVoiceTask(msg, workspaceId);
  // Reaction ✅ will be set inside handleVoiceTask on success, or ❌ on error
}

// ============================================================================
// /run-task TASK-123 — Lookup задачи по номеру (§5.3)
// ============================================================================

async function handleTaskLookupWithReaction(
  chatId: number,
  fullId: string,
  messageId: number,
  threadId?: number
): Promise<void> {
  // Reaction 👀 at start
  await setMessageReaction(BOT_TOKEN!, chatId, messageId, '👀').catch(() => {});

  try {
    // Use find_task_by_full_id RPC to get task UUID
    const { data: taskId, error } = await supabase.rpc('find_task_by_full_id', { p_full_id: fullId });

    if (error || !taskId) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        message_thread_id: threadId,
        rich_message: { html: `Задача ${escapeHtml(fullId)} не найдена.` },
      });
      // Reaction ❌ on error
      await setMessageReaction(BOT_TOKEN!, chatId, messageId, '❌').catch(() => {});
      return;
    }

    // Fetch full task details
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (taskErr || !task) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        message_thread_id: threadId,
        rich_message: { html: `Не удалось загрузить задачу ${escapeHtml(fullId)}.` },
      });
      await setMessageReaction(BOT_TOKEN!, chatId, messageId, '❌').catch(() => {});
      return;
    }

    const html = buildTaskCardHTML({
      full_id: fullId,
      title: task.title || '',
      description: task.description as string | undefined,
      column: task.column as string | undefined,
      priority: task.priority as string | undefined,
      assignee_name: (task as any).assignee_name as string | undefined,
      deadline: task.deadline ? new Date(task.deadline).toLocaleDateString() : undefined,
    });

    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      message_thread_id: threadId,
      rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
    });

    // Reaction ✅ on success
    await setMessageReaction(BOT_TOKEN!, chatId, messageId, '✅').catch(() => {});
  } catch (err) {
    console.error('[Bot Commands] handleTaskLookup error:', err);
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `⚠️ Ошибка при поиске задачи ${escapeHtml(fullId)}.` },
    });
    await setMessageReaction(BOT_TOKEN!, chatId, messageId, '❌').catch(() => {});
  }
}

// ============================================================================
// /help — Список команд
// ============================================================================

async function handleHelp(chatId: number): Promise<void> {
  const html = `<b>📖 Команды:</b>

<b>/create-task</b> [текст] — создать задачу
<b>/create-task</b> 🎤 — создать задачу голосом

<b>/run-task</b> TASK-123 — показать задачу

<b>/help</b> — справка`;

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}