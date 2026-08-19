// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Commands:
// /task [text|voice] — создать задачу
// /call TASK-123 — показать задачу
// /backlog — задачи без исполнителя
// /help — справка
// /start — onboarding
// Aliases: /create, /create-task → /task; /run-task, /run → /call

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyTelegramWebhookSecret,
  sendMessage,
  sendChatAction,
  answerCallbackQuery,
  editMessageText,
  buildWorkspaceSelectionKeyboard,
  parseWorkspaceCallbackData,
  escapeHtml,
  buildTaskCard,
  setMessageReaction,
  TaskCardData,
} from '../../../../../lib/bot';
import { handleStartCommand } from '../../../../../src/lib/bot/onboarding';
import { handleCommand } from '../../../../../src/lib/bot/commands';
import {
  resolveWorkspace,
  getUserAvailableWorkspaces,
  resolveProfileId,
} from '../../../../../src/lib/bot/workspaceResolver';
import { checkFreemiumBoundary } from '../../../../../src/lib/bot/freemium';
import {
  setPendingTask,
  clearPendingTask,
  isPendingTaskMode,
} from '../../../../../src/lib/bot/taskDraft';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_BOT_SECRET;

/** Единый текст справки — /help, /start, fallback */
const HELP_TEXT =
  '📖 Команды:\n' +
  '/task — создать задачу (текст или голос)\n' +
  '/call TASK-123 — показать задачу\n' +
  '/backlog — задачи без исполнителя\n' +
  '/help — справка';

let cachedBotUsername: string | null = null;

async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  if (!BOT_TOKEN) return null;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    if (resp.ok) {
      const data = await resp.json();
      cachedBotUsername = data.result?.username ?? null;
      return cachedBotUsername;
    }
  } catch (err) {
    console.warn('[Bot Webhook] getMe failed:', err);
  }
  return null;
}

function parseCommand(text: string): [string, string] | null {
  const trimmed = text.trim();
  const match = trimmed.match(
    /^\/([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/
  );
  if (!match) return null;
  return [match[1].toLowerCase(), (match[2] || '').trim()];
}

function normalizeCommand(command: string): string {
  switch (command) {
    case 'create':
    case 'create-task':
      return 'task';
    case 'run-task':
    case 'run':
      return 'call';
    default:
      return command;
  }
}

const COMMANDS_REQUIRING_WORKSPACE = ['task', 'backlog'];
const WORKSPACE_FREE_COMMANDS = ['start', 'help'];

function looksLikeTaskFullId(text: string): boolean {
  return /^[A-Z]{2,6}-\d{1,6}$/.test(text.trim());
}

function stripBotMentionFromArgs(args: string, botUsername: string): string {
  if (!args) return '';
  let result = args.replace(new RegExp(`^\\s*@${botUsername}\\s+`, 'gi'), '');
  result = result.replace(new RegExp(`\\s+@${botUsername}\\s*$`, 'gi'), '');
  result = result.replace(new RegExp(`^\\s*@${botUsername}\\s*$`, 'gi'), '');
  return result.trim();
}

async function checkBotMention(message: any): Promise<boolean> {
  const botUsername = await getBotUsername();
  if (!botUsername) return false;

  const entities = message.entities || message.reply_to_message?.entities;
  if (!entities || !Array.isArray(entities)) return false;

  const text = message.text || message.caption || '';

  for (const entity of entities) {
    if (entity.type === 'mention') {
      const username = text
        .substring(entity.offset + 1, entity.offset + entity.length)
        .toLowerCase();
      if (username === botUsername.toLowerCase()) return true;
    } else if (entity.type === 'bot_command') {
      const cmdText = text
        .substring(entity.offset, entity.offset + entity.length)
        .toLowerCase();
      if (
        cmdText === botUsername.toLowerCase() ||
        cmdText.endsWith('@' + botUsername.toLowerCase())
      ) {
        return true;
      }
    } else if (entity.type === 'text_mention') {
      return true;
    }
  }
  return false;
}

async function downloadTelegramFile(fileId: string): Promise<Blob | null> {
  if (!BOT_TOKEN) {
    console.error('[Bot Webhook] downloadTelegramFile: BOT_TOKEN missing');
    return null;
  }
  try {
    const getFileResp = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    if (!getFileResp.ok) {
      console.warn('[Bot Webhook] getFile failed:', getFileResp.status);
      return null;
    }
    const getFileData = await getFileResp.json();
    const filePath = getFileData?.result?.file_path;
    if (!filePath) {
      console.warn('[Bot Webhook] getFile returned no file_path');
      return null;
    }

    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const fileResp = await fetch(downloadUrl);
    if (!fileResp.ok) {
      console.warn('[Bot Webhook] file download failed:', fileResp.status);
      return null;
    }

    const arrayBuffer = await fileResp.arrayBuffer();
    return new Blob([arrayBuffer], { type: 'audio/ogg' });
  } catch (err) {
    console.error('[Bot Webhook] downloadTelegramFile error:', err);
    return null;
  }
}

async function safeSendChatAction(chatId: number): Promise<void> {
  if (!BOT_TOKEN) {
    console.warn('[Bot Webhook] safeSendChatAction: BOT_TOKEN missing');
    return;
  }
  try {
    await Promise.race([
      sendChatAction(BOT_TOKEN, { chat_id: chatId, action: 'typing' }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sendChatAction timeout 3s')), 3000)
      ),
    ]);
  } catch (err: any) {
    console.warn(
      '[Bot Webhook] sendChatAction failed/timeout:',
      err?.message || String(err)
    );
  }
}

async function dispatchUpdate(update: any): Promise<void> {
  const callbackQuery = update.callback_query;
  if (callbackQuery) {
    await handleCallbackQuery(callbackQuery);
    return;
  }

  const message = update.message || update.edited_message;
  if (!message) {
    console.log('[Bot Webhook] Ignoring non-message update');
    return;
  }

  if (!BOT_TOKEN) {
    console.error('[Bot Webhook] BOT_TOKEN is not configured');
    return;
  }

  const chat = message.chat;
  const chatId = chat.id;
  const text = message.text;
  const userId = message.from?.id;

  if (!userId) {
    console.error('[Bot Webhook] ERROR No user id in message');
    return;
  }

  let effectiveUserId = userId;
  const chatType = chat.type;

  if (chatType !== 'private') {
    const botMentioned = await checkBotMention(message);
    if (!botMentioned) {
      console.log('[Bot Webhook] Ignoring non-private chat without bot mention');
      return;
    }
    if (message.reply_to_message?.from) {
      effectiveUserId = message.reply_to_message.from.id;
    }
  }

  await safeSendChatAction(chatId);

  let parsedCommand: [string, string] | null = null;
  if (text && text.startsWith('/')) {
    parsedCommand = parseCommand(text);
  }

  if (parsedCommand && chatType !== 'private') {
    const resolvedBotUsername = await getBotUsername();
    if (resolvedBotUsername) {
      const cleanedArgs = stripBotMentionFromArgs(parsedCommand[1], resolvedBotUsername);
      parsedCommand = [parsedCommand[0], cleanedArgs];
    }
  }

  if (parsedCommand) {
    const [rawCmd, args] = parsedCommand;
    parsedCommand = [normalizeCommand(rawCmd), args];
    console.log('[Bot Webhook] parsedCommand=', parsedCommand[0], 'args=', args);
  }

  // ── /start ──
  if (parsedCommand && parsedCommand[0] === 'start') {
    try {
      await handleStartCommand(message, parsedCommand[1]);
    } catch (err) {
      console.error('[Bot Webhook] ERROR handleStartCommand:', err);
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Ошибка при обработке /start.\n\n' + HELP_TEXT,
      }).catch(() => {});
    }
    return;
  }

  // ── /help ──
  if (parsedCommand && parsedCommand[0] === 'help') {
    try {
      await handleCommand(message, 'help', parsedCommand[1], '');
    } catch {
      await sendMessage(BOT_TOKEN, { chat_id: chatId, text: HELP_TEXT });
    }
    return;
  }

  // ── /call TASK-123 — lookup (workspace not required) ──
  if (parsedCommand && parsedCommand[0] === 'call') {
    const args = parsedCommand[1];
    if (looksLikeTaskFullId(args)) {
      const fullId = args.trim().toUpperCase();
      await handleResolveTask(BOT_TOKEN, chatId, userId, message.message_id, fullId);
    } else {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '📝 Введите ID задачи, например:\n/call ALPHA-123',
      });
    }
    return;
  }

  // Step 2: Resolve workspace
  let workspaceResult: { workspace_id: string } | null = null;
  try {
    workspaceResult = await resolveWorkspace(effectiveUserId, chatId, chatType);
  } catch (err: any) {
    console.error('[Bot Webhook] resolveWorkspace error:', err?.message || err);
  }

  if (workspaceResult && parsedCommand) {
    const [command, args] = parsedCommand;
    const workspaceId = workspaceResult.workspace_id;

    if (command === 'task') {
      const gateMessage = await checkFreemiumBoundary(
        'create-task',
        effectiveUserId,
        workspaceId
      );
      if (gateMessage) {
        await sendMessage(BOT_TOKEN, { chat_id: chatId, text: gateMessage });
        return;
      }
      await handleCommandRequiringWorkspace(
        chatId,
        effectiveUserId,
        'task',
        args,
        message
      );
      return;
    }

    if (command === 'backlog') {
      const gateMessage = await checkFreemiumBoundary(
        'backlog',
        effectiveUserId,
        workspaceId
      );
      if (gateMessage) {
        await sendMessage(BOT_TOKEN, { chat_id: chatId, text: gateMessage });
        return;
      }
      await handleBacklog(BOT_TOKEN, chatId, workspaceId);
      return;
    }

    // unknown with workspace
    await sendMessage(BOT_TOKEN, { chat_id: chatId, text: HELP_TEXT });
    return;
  }

  // Step 3: No workspace + command
  if (parsedCommand) {
    const [command, args] = parsedCommand;

    if (WORKSPACE_FREE_COMMANDS.includes(command)) {
      await handleCommand(message, command, args, '');
      return;
    }

    if (command === 'task') {
      await handleCommandRequiringWorkspace(
        chatId,
        effectiveUserId,
        'task',
        args,
        message
      );
      return;
    }

    if (command === 'backlog') {
      // need workspace selection first — reuse workspace flow
      const available = await getUserAvailableWorkspaces(effectiveUserId);
      if (available.length === 0) {
        await sendMessage(BOT_TOKEN, {
          chat_id: chatId,
          text: 'У вас нет доступных рабочих пространств.',
        });
        return;
      }
      if (available.length === 1) {
        await handleBacklog(BOT_TOKEN, chatId, available[0].id);
        return;
      }
      const keyboard = buildWorkspaceSelectionKeyboard(available, {
        command: 'backlog',
      });
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: 'Выберите доску:',
        reply_markup: keyboard,
      });
      return;
    }

    await sendMessage(BOT_TOKEN, { chat_id: chatId, text: HELP_TEXT });
    return;
  }

  // Step 4: Pending task mode
  const pendingActive = await isPendingTaskMode(chatId);

  if (pendingActive) {
    const profileId = await resolveProfileId(effectiveUserId);
    if (!profileId) {
      await clearPendingTask(chatId);
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Профиль не найден. Начните с /start.',
      });
      return;
    }

    let taskText = '';
    let source: string = 'nl';

    if (text && text.trim().length > 0) {
      taskText = text.trim();
      source = 'nl';
    } else if (message.voice) {
      if (message.caption?.trim()) {
        taskText = message.caption.trim();
        source = 'voice_with_caption';
      } else {
        const blob = await downloadTelegramFile(message.voice.file_id);
        if (blob) {
          const formData = new FormData();
          formData.append('audio', blob, 'voice.ogg');
          const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          const baseUrl =
            process.env.NEXT_PUBLIC_WEBAPP_URL || `https://${process.env.VERCEL_URL}`;
          try {
            const sttResp = await fetch(`${baseUrl}/api/ai/transcribe`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${serviceKey}` },
              body: formData,
            });
            if (sttResp.ok) {
              const sttData = await sttResp.json();
              taskText = sttData.text || '[Голосовое сообщение]';
              source = 'voice';
            } else {
              taskText = '[Голосовое сообщение — текст недоступен]';
              source = 'voice';
            }
          } catch {
            taskText = '[Голосовое сообщение — текст недоступен]';
            source = 'voice';
          }
        } else {
          taskText = '[Голосовое сообщение — не удалось скачать]';
          source = 'voice';
        }
      }
    } else if (message.audio) {
      const blob = await downloadTelegramFile(message.audio.file_id);
      if (blob) {
        const formData = new FormData();
        formData.append('audio', blob, 'audio.ogg');
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const baseUrl =
          process.env.NEXT_PUBLIC_WEBAPP_URL || `https://${process.env.VERCEL_URL}`;
        try {
          const sttResp = await fetch(`${baseUrl}/api/ai/transcribe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${serviceKey}` },
            body: formData,
          });
          if (sttResp.ok) {
            const sttData = await sttResp.json();
            taskText = sttData.text || '[Аудио сообщение]';
            source = 'audio_file';
          } else {
            taskText = '[Аудио сообщение — текст недоступен]';
            source = 'audio_file';
          }
        } catch {
          taskText = '[Аудио сообщение — текст недоступен]';
          source = 'audio_file';
        }
      } else {
        taskText = '[Аудио сообщение — не удалось скачать]';
        source = 'audio_file';
      }
    } else if (message.video_note) {
      taskText =
        '[Круглое видео — бот не может распознать текст. Отправьте обычное голосовое сообщение]';
      source = 'video_note';
    }

    if (taskText.length > 0) {
      await clearPendingTask(chatId);

      const { data: draftResult, error: draftError } = await supabase.rpc(
        'create_bot_task_draft',
        {
          p_user_id: profileId,
          p_chat_id: chatId,
          p_title: taskText.slice(0, 500),
          p_description: null,
          p_source: source,
        }
      );

      if (draftError || !draftResult) {
        await sendMessage(BOT_TOKEN, {
          chat_id: chatId,
          text: '⚠️ Не удалось сохранить черновик. Отправьте задачу заново через /task.',
        });
        return;
      }

      const availableWorkspaces = await getUserAvailableWorkspaces(effectiveUserId);
      if (availableWorkspaces.length === 0) {
        await sendMessage(BOT_TOKEN, {
          chat_id: chatId,
          text: 'У вас нет доступных рабочих пространств.',
        });
        return;
      }

      if (availableWorkspaces.length === 1) {
        await executeDraftInWorkspaceByChat(
          BOT_TOKEN,
          chatId,
          effectiveUserId,
          availableWorkspaces[0].id
        );
        return;
      }

      const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, {
        draftId: draftResult,
      });
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '✅ Черновик сохранён! Выберите доску:',
        reply_markup: keyboard,
      });
      return;
    }

    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: '📝 Пожалуйста, отправьте текст или голосовое сообщение для создания задачи.',
    });
    return;
  }

  // No pending — help
  await sendMessage(BOT_TOKEN, { chat_id: chatId, text: HELP_TEXT });
}

async function handleCommandRequiringWorkspace(
  chatId: number,
  userId: number,
  command: string,
  args: string,
  message?: any
): Promise<void> {
  if (!BOT_TOKEN) return;

  const profileId = await resolveProfileId(userId);
  if (!profileId) {
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: '⚠️ Профиль не найден. Начните с /start.',
    });
    return;
  }

  const availableWorkspaces = await getUserAvailableWorkspaces(userId);
  if (availableWorkspaces.length === 0) {
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: 'У вас нет доступных рабочих пространств. Введите код через администратора.',
    });
    return;
  }

  let effectiveArgs = args;
  if (message?.reply_to_message?.text) {
    effectiveArgs = message.reply_to_message.text.trim();
  }

  if (availableWorkspaces.length === 1) {
    const ws = availableWorkspaces[0];
    if (!effectiveArgs || effectiveArgs.trim().length === 0) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text:
          '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\n' +
          'Бот сохранит черновик и создаст задачу.',
      });
      await setPendingTask(chatId, profileId);
      return;
    }

    const trimmedArgs = effectiveArgs.trim();
    const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
      p_user_id: profileId,
      p_chat_id: chatId,
      p_title: trimmedArgs.slice(0, 500),
      p_description: null,
      p_source: 'nl',
    });

    if (error || !draftResult) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
      });
      return;
    }

    await executeDraftInWorkspaceByChat(BOT_TOKEN, chatId, userId, ws.id);
    return;
  }

  if (!effectiveArgs || effectiveArgs.trim().length === 0) {
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text:
        '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\n' +
        'Бот сохранит черновик и предложит выбрать доску.',
    });
    await setPendingTask(chatId, profileId);
    return;
  }

  const trimmedArgs = effectiveArgs.trim();
  const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
    p_user_id: profileId,
    p_chat_id: chatId,
    p_title: trimmedArgs.slice(0, 500),
    p_description: null,
    p_source: 'nl',
  });

  if (error || !draftResult) {
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
    });
    return;
  }

  const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, {
    draftId: draftResult,
  });
  await sendMessage(BOT_TOKEN, {
    chat_id: chatId,
    text: '✅ Черновик сохранён! Выберите доску:',
    reply_markup: keyboard,
  });
}

async function handleBacklog(
  token: string,
  chatId: number,
  workspaceId: string
): Promise<void> {
  const { data: ws } = await supabase
    .from('workspaces')
    .select('task_prefix, name, slug')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, task_number, column, priority, deadline')
    .eq('workspace_id', workspaceId)
    .is('assigned_to', null)
    .neq('column', 'done')
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) {
    console.error('[Bot Webhook] handleBacklog error:', error);
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Не удалось загрузить список задач.',
    });
    return;
  }

  if (!tasks || tasks.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '📥 Нет задач без исполнителя.',
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

  await sendMessage(token, {
    chat_id: chatId,
    text:
      `📥 <b>Без исполнителя</b> · ${escapeHtml(boardName)}\n\n` + lines.join('\n'),
    parse_mode: 'HTML',
  });
}

async function handleCallbackQuery(callbackQuery: any): Promise<void> {
  const token = BOT_TOKEN;
  if (!token) return;

  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const userId = callbackQuery.from?.id;
  const data = callbackQuery.data;

  const answer = async (opts?: { text?: string; show_alert?: boolean }) => {
    try {
      await answerCallbackQuery(token, {
        callback_query_id: callbackQuery.id,
        ...opts,
      });
    } catch (err) {
      console.warn('[Bot Webhook] answerCallbackQuery failed:', err);
    }
  };

  if (!chatId || !data) {
    await answer({ text: 'Неизвестная ошибка', show_alert: true });
    return;
  }

  const parsed = parseWorkspaceCallbackData(data);
  if (!parsed.workspaceId) {
    await answer({ text: 'Неверный формат кнопки', show_alert: true });
    return;
  }

  await answer();

  const { workspaceId, type, extra } = parsed;

  const { data: wsData } = await supabase
    .from('workspaces')
    .select('slug, name')
    .eq('id', workspaceId)
    .maybeSingle();

  if (!wsData) {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: '⚠️ Рабочее пространство не найдено.',
    });
    return;
  }

  try {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: `✅ Выбрано рабочее пространство: <b>${escapeHtml(wsData.name || wsData.slug)}</b>`,
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.warn('[Bot Webhook] editMessageText failed:', err);
  }

  if (type === 'command') {
    if (extra === 'backlog') {
      await handleBacklog(token, chatId, workspaceId);
    } else {
      await executeCommandInWorkspace(token, chatId, userId, workspaceId, extra);
    }
  } else if (type === 'draft') {
    await executeDraftInWorkspaceByChat(token, chatId, userId, workspaceId);
  }
}

async function executeCommandInWorkspace(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  extra: string
): Promise<void> {
  const colonIdx = extra.indexOf(':');
  let command: string;
  let args: string;
  if (colonIdx >= 0) {
    command = extra.substring(0, colonIdx);
    args = extra.substring(colonIdx + 1);
  } else {
    command = extra;
    args = '';
  }

  if (command === 'backlog') {
    await handleBacklog(token, chatId, workspaceId);
    return;
  }

  const fakeMessage = {
    chat: { id: chatId },
    from: { id: userId },
    text: `/${command}${args ? ' ' + args : ''}`,
  };

  await handleCommand(fakeMessage as any, command, args, workspaceId);
}

async function executeDraftInWorkspaceByChat(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string
): Promise<void> {
  const { data: draft, error } = await supabase.rpc('consume_latest_bot_task_draft', {
    p_chat_id: chatId,
  });

  if (error || !draft || draft.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик не найден или истёк. Отправьте задачу заново через /task.',
    });
    return;
  }

  const draftRow = draft[0];
  if (!draftRow.title) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик пустой. Отправьте задачу заново через /task.',
    });
    return;
  }

  const taskText = draftRow.title;
  const profileId = await resolveProfileId(userId);

  let aiResult: {
    task?: {
      id: string;
      title: string;
      description?: string | null;
      column: string;
      priority: string;
      deadline?: string | null;
    };
    parse?: {
      rewritten_title?: string;
      rewritten_description?: string;
      clarity_score?: number;
      deadline?: string | null;
    };
    showCorrectionSheet?: boolean;
  };

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const baseUrl =
      process.env.NEXT_PUBLIC_WEBAPP_URL || `https://${process.env.VERCEL_URL}`;

    const resp = await fetch(`${baseUrl}/api/ai/create-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        input: taskText,
        workspace_id: workspaceId,
        source: 'bot',
        profile_id: profileId ?? undefined,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${resp.status}`);
    }

    aiResult = await resp.json();
  } catch (err) {
    console.error('[Bot Webhook] F-04 create-task failed:', err);
    await createTaskFallback(token, chatId, userId, workspaceId, draftRow);
    return;
  }

  const task = aiResult.task;
  if (!task) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Задача не создана. Попробуйте ещё раз.',
    });
    return;
  }

  const { data: wsWithPrefix } = await supabase
    .from('workspaces')
    .select('task_prefix, slug, name')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: taskWithNumber } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsWithPrefix?.task_prefix || '?'}-${taskWithNumber?.task_number || '?'}`;

  const cardData: TaskCardData = {
    fullId,
    title: task.title,
    description:
      aiResult.parse?.rewritten_description ?? task.description ?? null,
    column: task.column,
    isInbox: false,
    isBlocked: false,
    priority: task.priority as 'high' | 'medium' | 'low' | null,
    dueDate: task.deadline ?? aiResult.parse?.deadline ?? null,
    assigneeName: null,
    workspaceHandle: wsWithPrefix?.name || wsWithPrefix?.slug || '',
    clarityScore: aiResult.parse?.clarity_score ?? null,
  };

  const taskCard = buildTaskCard(cardData, 'created');

  try {
    await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });
  } catch (err) {
    console.error('[Bot Webhook] sendMessage (task card) failed:', err);
    await sendMessage(token, {
      chat_id: chatId,
      text: `✅ Задача создана: ${fullId} · «${task.title}»`,
    }).catch(() => {});
  }
}

async function createTaskFallback(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  draftRow: any
): Promise<void> {
  let createdBy: string | null = null;
  if (draftRow.user_id) {
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', draftRow.user_id)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle();
    createdBy = worker?.id ?? null;
  }

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      title: draftRow.title,
      description: draftRow.description || null,
      source: 'bot',
      created_by: createdBy,
      is_inbox: false,
      column: 'backlog',
      priority: 'medium',
      version: 0,
    })
    .select('id, title, description, column, priority, version')
    .single();

  if (taskError || !task) {
    await sendMessage(token, {
      chat_id: chatId,
      text: `⚠️ Не удалось создать задачу: ${taskError?.message || 'неизвестная ошибка'}`,
    });
    return;
  }

  const { data: wsForFallback } = await supabase
    .from('workspaces')
    .select('task_prefix, slug, name')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: taskWithNumber2 } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsForFallback?.task_prefix || '?'}-${taskWithNumber2?.task_number || '?'}`;

  const cardData: TaskCardData = {
    fullId,
    title: task.title,
    description: task.description ?? null,
    column: task.column,
    isInbox: false,
    isBlocked: false,
    priority: task.priority as 'high' | 'medium' | 'low' | null,
    dueDate: null,
    assigneeName: null,
    workspaceHandle: wsForFallback?.name || wsForFallback?.slug || '',
    clarityScore: null,
  };

  const taskCard = buildTaskCard(cardData, 'created');

  try {
    await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });
  } catch (err) {
    console.error('[Bot Webhook] sendMessage (fallback) failed:', err);
  }
}

async function handleResolveTask(
  token: string,
  chatId: number,
  userId: number,
  messageId: number,
  fullId: string
): Promise<void> {
  await setMessageReaction(token, chatId, messageId, '👀').catch(() => {});

  try {
    const { data: cardData, error: rpcError } = await supabase.rpc(
      'get_task_card_data_by_full_id',
      { p_full_id: fullId }
    );

    if (rpcError || !cardData) {
      await sendMessage(token, {
        chat_id: chatId,
        text: `⚠️ Задача ${escapeHtml(fullId)} не найдена. Проверьте формат (например, ALPHA-123).`,
        parse_mode: 'HTML',
      });
      await setMessageReaction(token, chatId, messageId, '❌').catch(() => {});
      return;
    }

    const taskCard = buildTaskCard(cardData as TaskCardData, 'lookup');
    await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });
    await setMessageReaction(token, chatId, messageId, '✅').catch(() => {});
  } catch (err) {
    console.error('[Bot Webhook] handleResolveTask error:', err);
    await sendMessage(token, {
      chat_id: chatId,
      text: `⚠️ Ошибка при поиске задачи ${escapeHtml(fullId)}.`,
      parse_mode: 'HTML',
    });
    await setMessageReaction(token, chatId, messageId, '❌').catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');

  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (!providedSecret || !verifyTelegramWebhookSecret(providedSecret, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    await dispatchUpdate(update as any);
  } catch (err) {
    console.error('[Bot Webhook] Unhandled dispatch error:', err);
  }

  return NextResponse.json({ ok: true });
}
