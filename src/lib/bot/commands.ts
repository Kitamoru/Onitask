// src/lib/bot/commands.ts — Команды бота
// /task [text|voice] — создание задачи
// /call FULL_ID — просмотр задачи
// /backlog — задачи без исполнителя
// /help — справка
//
// Reactions: 👀 при начале, ✅ при успехе, ❌ при ошибке

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

const HELP_HTML =
  `<b>📖 Команды:</b>\n` +
  `/task — создать задачу (текст или голос)\n` +
  `/call TASK-123 — показать задачу\n` +
  `/backlog — задачи без исполнителя\n` +
  `/help — справка`;

export const COMMANDS_REQUIRING_WORKSPACE = ['task', 'backlog'];
export const WORKSPACE_FREE_COMMANDS = ['start', 'help'];

/**
 * Route a command message to the appropriate handler.
 */
export async function handleCommand(
  msg: Message,
  command: string,
  args: string,
  workspaceId: string
): Promise<{ handled: boolean }> {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  switch (command) {
    case 'task':
    case 'create-task': // alias
      if (msg.voice || msg.audio) {
        await handleVoiceTaskWithReaction(msg, workspaceId, messageId);
      } else if (args && /^[A-Z]+-\d+$/i.test(args)) {
        // Пользователь перепутал с lookup
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: {
            html: `🔍 Для просмотра задачи используйте <b>/call ${escapeHtml(args.toUpperCase())}</b>`,
          },
        });
        await setMessageReaction(BOT_TOKEN!, chatId, messageId, '❌').catch(() => {});
      } else if (args) {
        await handleTextTaskWithReaction(msg, args, workspaceId, messageId);
      } else {
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: {
            html:
              '📝 Пришлите текст или голосовое сообщение для создания задачи.\n' +
              'Или <b>/call TASK-123</b> — показать задачу.',
          },
        });
      }
      return { handled: true };

    case 'call':
    case 'run-task': // alias
      if (args && /^[A-Z]+-\d+$/i.test(args)) {
        await handleTaskLookupWithReaction(
          chatId,
          args.toUpperCase(),
          messageId,
          msg.message_thread_id
        );
      } else {
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: {
            html: '📝 Введите ID задачи, например: <b>/call ALPHA-123</b>',
          },
        });
      }
      return { handled: true };

    case 'backlog':
      await handleBacklogCommand(chatId, workspaceId);
      return { handled: true };

    case 'help':
      await handleHelp(chatId);
      return { handled: true };

    default:
      return { handled: false };
  }
}

async function handleTextTaskWithReaction(
  msg: Message,
  text: string,
  workspaceId: string,
  messageId: number
): Promise<void> {
  const chatId = msg.chat.id;
  await setMessageReaction(BOT_TOKEN!, chatId, messageId, '👀').catch(() => {});
  await sendChatAction(BOT_TOKEN!, { chat_id: chatId, action: 'typing' }).catch(() => {});
  await handleTextTask(msg, text, workspaceId);
}

async function handleVoiceTaskWithReaction(
  msg: Message,
  workspaceId: string,
  messageId: number
): Promise<void> {
  const chatId = msg.chat.id;
  await setMessageReaction(BOT_TOKEN!, chatId, messageId, '👀').catch(() => {});
  await sendChatAction(BOT_TOKEN!, { chat_id: chatId, action: 'typing' }).catch(() => {});
  await handleVoiceTask(msg, workspaceId);
}

async function handleTaskLookupWithReaction(
  chatId: number,
  fullId: string,
  messageId: number,
  threadId?: number
): Promise<void> {
  await setMessageReaction(BOT_TOKEN!, chatId, messageId, '👀').catch(() => {});

  try {
    const { data: taskId, error } = await supabase.rpc('find_task_by_full_id', {
      p_full_id: fullId,
    });

    if (error || !taskId) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        message_thread_id: threadId,
        rich_message: { html: `Задача ${escapeHtml(fullId)} не найдена.` },
      });
      await setMessageReaction(BOT_TOKEN!, chatId, messageId, '❌').catch(() => {});
      return;
    }

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
      deadline: task.deadline
        ? new Date(task.deadline).toLocaleDateString('ru-RU')
        : undefined,
    });

    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      message_thread_id: threadId,
      rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
    });
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

async function handleBacklogCommand(chatId: number, workspaceId: string): Promise<void> {
  if (!workspaceId) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Сначала выберите рабочее пространство.' },
    });
    return;
  }

  const { data: ws } = await supabase
    .from('workspaces')
    .select('task_prefix, name, slug')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, task_number, column, priority')
    .eq('workspace_id', workspaceId)
    .is('assigned_to', null)
    .neq('column', 'done')
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) {
    console.error('[Bot Commands] backlog error:', error);
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось загрузить список задач.' },
    });
    return;
  }

  if (!tasks || tasks.length === 0) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '📥 Нет задач без исполнителя.' },
    });
    return;
  }

  const prefix = ws?.task_prefix || '?';
  const boardName = ws?.name || ws?.slug || '';

  const lines = tasks.map((t) => {
    const fullId = `${prefix}-${t.task_number}`;
    const pri =
      t.priority === 'high' ? '🔴' : t.priority === 'low' ? '🟢' : '🟡';
    return `${pri} <b>${escapeHtml(fullId)}</b> — ${escapeHtml(t.title || '')}`;
  });

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: {
      html:
        `📥 <b>Без исполнителя</b> · ${escapeHtml(boardName)}\n\n` +
        lines.join('\n'),
    },
  });
}

async function handleHelp(chatId: number): Promise<void> {
  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: HELP_HTML.slice(0, MAX_MESSAGE_LENGTH) },
  });
}
