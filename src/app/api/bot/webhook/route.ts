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
  setBotCommands,
  buildCommandReplyKeyboard,
  taskCommentsUrl,
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
import { resolveActorId } from '../../../../../src/lib/bot/actor';
import {
  setPendingTask,
  clearPendingTask,
  isPendingTaskMode,
} from '../../../../../src/lib/bot/taskDraft';
import {
  extractFileFromMessage,
  isAllowedBotFile,
  downloadTelegramFileBytes,
  saveAttachmentToTask,
  setBotAttachPending,
  consumeBotAttachPending,
} from '../../../../../src/lib/bot/attachments';
import { resolveTaskIdByReply, rememberBotTaskMessage } from '../../../../../lib/shared/attachments';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_BOT_SECRET;

let commandsRegistered = false;

async function ensureBotCommands(): Promise<void> {
  if (commandsRegistered || !BOT_TOKEN) return;
  try {
    await setBotCommands(BOT_TOKEN);
    commandsRegistered = true;
    console.log('[Bot Webhook] setMyCommands OK');
  } catch (err) {
    console.warn('[Bot Webhook] setMyCommands failed:', err);
  }
}

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
  return /^[A-Z]{2,6}-\d{1,6}$/i.test(text.trim());
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
  const userId = resolveActorId(message);

  if (!userId) {
    console.error('[Bot Webhook] ERROR No user id in message');
    return;
  }

  // Актор — автор команды (message.from), а не автор процитированного
  // сообщения. Раньше здесь стояла подмена effectiveUserId на
  // reply_to_message.from.id: у пересланного сообщения `from` — это
  // переславший, а не автор оригинала, поэтому /task в реплае на чужое
  // или пересланное сообщение уходил в «Профиль не найден. Начните с /start».
  const effectiveUserId = userId;
  const chatType = chat.type;

  if (chatType !== 'private') {
    const botMentioned = await checkBotMention(message);
    if (!botMentioned) {
      console.log('[Bot Webhook] Ignoring non-private chat without bot mention');
      return;
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

  // ── Миграция 051: текст в DM при незавершённом запросе причины = причина ──
  if (!parsedCommand && chatType === 'private' && text) {
    const consumed = await tryConsumeReviewFixReason(chatId, userId, text);
    if (consumed) return;
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

    if (chatType === 'private') {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: 'Команды быстрого доступа:',
        reply_markup: buildCommandReplyKeyboard(),
      }).catch((err) => {
        console.warn('[Bot Webhook] Failed to send command keyboard:', err);
      });
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

    // FILE-04: /attach — прикрепить файл к задаче
    if (command === 'attach') {
      await handleAttachCommand(
        chatId,
        effectiveUserId,
        workspaceId,
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

  // FILE-04: pending attach — юзер ввёл full_id (без /attach) → прикрепить
  if (
    !parsedCommand &&
    text &&
    looksLikeTaskFullId(text) &&
    workspaceResult
  ) {
    const pending = await consumeBotAttachPending(chatId);
    if (pending && pending.length > 0) {
      const fullId = text.trim().toUpperCase();
      const taskId = await resolveTaskIdByFullId(
        fullId,
        workspaceResult.workspace_id
      );
      if (!taskId) {
        await sendMessage(BOT_TOKEN, {
          chat_id: chatId,
          text: `⚠️ Задача ${escapeHtml(fullId)} не найдена.`,
        });
        return;
      }
      let attached = 0;
      let failed = 0;
      for (const meta of pending) {
        const dl = await downloadTelegramFileBytes(BOT_TOKEN, meta.file_id);
        if (dl) {
          const ok = await saveAttachmentToTask({
            workspaceId: workspaceResult.workspace_id,
            taskId,
            userId: effectiveUserId,
            filename: meta.filename,
            bytes: dl.bytes,
          });
          if (ok) attached++;
          else failed++;
        } else failed++;
      }
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: `✅ Файлы прикреплены к ${escapeHtml(fullId)}${
          failed ? ` · ${failed} не удалось` : ''
        }`,
      });
      return;
    }
  }

  // FILE-04: входящий файл (document/photo) без команды
  if (!parsedCommand) {
    const fileAttachment = extractFileFromMessage(message);
    if (fileAttachment) {
      await handleIncomingFileMessage(
        chatId,
        effectiveUserId,
        workspaceResult?.workspace_id ?? '',
        fileAttachment,
        message
      );
      return;
    }
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

async function handleAttachCommand(
  chatId: number,
  userId: number,
  workspaceId: string,
  args: string,
  message?: any
): Promise<void> {
  if (!BOT_TOKEN) return;

  const fileAttachment = extractFileFromMessage(message);
  const reply = message?.reply_to_message;

  // Приоритет 1: reply на карточку задачи → attach
  if (reply && reply.message_id) {
    const taskId = await resolveTaskIdByReply({
      supabase,
      chatId,
      messageId: reply.message_id,
    });
    if (!taskId) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Не нашёл задачу этого сообщения. Ответьте reply на карточку задачи + пришлите файл, или укажите full_id: /attach ALPHA-123 + файл.',
      });
      return;
    }
    if (!fileAttachment) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '📎 Пришлите файл вместе с /attach (reply на карточку задачи).',
      });
      return;
    }
    if (!isAllowedBotFile(fileAttachment.filename)) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Этот тип файла не поддерживается.',
      });
      return;
    }
    const dl = await downloadTelegramFileBytes(BOT_TOKEN, fileAttachment.fileId);
    if (!dl) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Не удалось скачать файл, попробуйте ещё раз.',
      });
      return;
    }
    const ok = await saveAttachmentToTask({
      workspaceId,
      taskId,
      userId,
      filename: dl.filename,
      bytes: dl.bytes,
      mimeType: fileAttachment.mimeHint,
    });
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: ok ? '✅ Файл прикреплён к задаче.' : '⚠️ Не удалось прикрепить файл.',
    });
    return;
  }

  // Приоритет 2: файл есть, без reply → буфер + запрос full_id
  if (fileAttachment) {
    if (!isAllowedBotFile(fileAttachment.filename)) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Этот тип файла не поддерживается.',
      });
      return;
    }
    const ok = await setBotAttachPending({
      workspaceId,
      chatId,
      userId,
      fileId: fileAttachment.fileId,
      filename: fileAttachment.filename,
    });
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: ok
        ? '📎 Файл сохранён. Укажите full_id задачи, к которой прикрепить (например ALPHA-123):'
        : '⚠️ Не удалось сохранить файл. Попробуйте ещё раз.',
    });
    return;
  }

  // Приоритет 3: args = full_id + есть pending
  const fullId = args.trim().toUpperCase();
  if (looksLikeTaskFullId(fullId)) {
    const pending = await consumeBotAttachPending(chatId);
    if (!pending || pending.length === 0) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: '⚠️ Нет сохранённого файла. Пришлите /attach + файл, затем укажите full_id.',
      });
      return;
    }
    const taskId = await resolveTaskIdByFullId(fullId, workspaceId);
    if (!taskId) {
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: `⚠️ Задача ${escapeHtml(fullId)} не найдена в этой доске.`,
      });
      return;
    }
    let attached = 0;
    let failed = 0;
    for (const meta of pending) {
      const dl = await downloadTelegramFileBytes(BOT_TOKEN, meta.file_id);
      if (dl) {
        const ok = await saveAttachmentToTask({
          workspaceId,
          taskId,
          userId,
          filename: meta.filename,
          bytes: dl.bytes,
        });
        if (ok) attached++;
        else failed++;
      } else failed++;
    }
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: `✅ Файлы прикреплены к ${escapeHtml(fullId)}${
        failed ? ` · ${failed} не удалось` : ''
      }`,
    });
    return;
  }

  await sendMessage(BOT_TOKEN, {
    chat_id: chatId,
    text:
      '📎 Чтобы прикрепить файл к задаче:\n' +
      '1) /attach + файл, затем укажите full_id\n' +
      '2) или reply на карточку задачи + пришлите файл\n' +
      '3) или /attach ALPHA-123 + файл',
  });
}

async function resolveTaskIdByFullId(
  fullId: string,
  workspaceId: string
): Promise<string | null> {
  const { data } = await supabase.rpc('find_task_by_full_id', {
    p_full_id: fullId,
  });
  if (!data) return null;
  // Проверка tenant-изоляции: задача должна принадлежать этой доске
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', data as string)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return task ? (task.id as string) : null;
}

async function handleIncomingFileMessage(
  chatId: number,
  userId: number,
  workspaceId: string,
  fileAttachment: any,
  message: any
): Promise<void> {
  if (!BOT_TOKEN) return;

  if (!workspaceId) {
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: '⚠️ Сначала выберите рабочее пространство (/start).',
    });
    return;
  }
  if (!isAllowedBotFile(fileAttachment.filename)) {
    await sendMessage(BOT_TOKEN, {
      chat_id: chatId,
      text: '⚠️ Этот тип файла не поддерживается.',
    });
    return;
  }

  // 1) Reply на карточку задачи → attach
  const reply = message?.reply_to_message;
  if (reply && reply.message_id) {
    const taskId = await resolveTaskIdByReply({
      supabase,
      chatId,
      messageId: reply.message_id,
    });
    if (taskId) {
      const dl = await downloadTelegramFileBytes(
        BOT_TOKEN,
        fileAttachment.fileId
      );
      const ok =
        dl &&
        (await saveAttachmentToTask({
          workspaceId,
          taskId,
          userId,
          filename: dl.filename,
          bytes: dl.bytes,
          mimeType: fileAttachment.mimeHint,
        }));
      await sendMessage(BOT_TOKEN, {
        chat_id: chatId,
        text: ok
          ? '✅ Файл прикреплён к задаче.'
          : '⚠️ Не удалось прикрепить файл.',
      });
      return;
    }
  }

  // 2) Файл + caption → задача из caption + attach (файл уходит в pending)
  const caption = (message?.caption ?? '').trim();
  if (caption) {
    await setBotAttachPending({
      workspaceId,
      chatId,
      userId,
      fileId: fileAttachment.fileId,
      filename: fileAttachment.filename,
    });
    await handleCommandRequiringWorkspace(
      chatId,
      userId,
      'task',
      caption,
      message
    );
    return;
  }

  // 3) Файл без caption → буфер + спросить назначение
  await setBotAttachPending({
    workspaceId,
    chatId,
    userId,
    fileId: fileAttachment.fileId,
    filename: fileAttachment.filename,
  });
  await sendMessage(BOT_TOKEN, {
    chat_id: chatId,
    text:
      '📎 Файл сохранён. Назначение?\n' +
      '— Чтобы прикрепить к существующей задаче, укажите full_id (например ALPHA-123)\n' +
      '— Чтобы создать новую задачу, пришлите её текст',
  });
}

/** Прикрепление файлов, забуференных до создания задачи (caption-флоу). */
async function attachPendingFilesToTask(
  taskId: string,
  workspaceId: string,
  chatId: number
): Promise<void> {
  const pending = await consumeBotAttachPending(chatId);
  if (!pending || pending.length === 0 || !BOT_TOKEN) return;
  for (const meta of pending) {
    const dl = await downloadTelegramFileBytes(BOT_TOKEN, meta.file_id);
    if (dl) {
      await saveAttachmentToTask({
        workspaceId,
        taskId,
        userId: 0,
        filename: meta.filename,
        bytes: dl.bytes,
      });
    }
  }
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

  // Review approval buttons (миграция 049/051):
  //   ra:approve:<task_uuid> — согласовать → done
  //   ra:fix:<task_uuid>     — запросить текст причины возврата (051)
  //   ra:back:<task_uuid>    — отмена запроса причины → вернуть карточку ревью
  // workspace_id НЕ встроен в callback_data (лимит 64 байта) — резолвим из задачи.
  if (data.startsWith('ra:')) {
    const parts = data.split(':');
    const action = parts[1];
    const taskId = parts[2];
    if (
      (action !== 'approve' && action !== 'fix' && action !== 'back') ||
      !taskId
    ) {
      await answer({ text: 'Неверный формат кнопки', show_alert: true });
      return;
    }
    await answer();
    await handleReviewAction(
      action as 'approve' | 'fix' | 'back',
      taskId,
      userId,
      chatId,
      messageId
    );
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

// ============================================================================
// Review approval (миграция 049): кнопки ra:approve / ra:fix из DM бот-нотифая
// ============================================================================

async function handleReviewAction(
  action: 'approve' | 'fix' | 'back',
  taskId: string,
  telegramUserId: number | undefined,
  chatId: number,
  messageId: number | undefined
): Promise<void> {
  const token = BOT_TOKEN;
  if (!token) return;

  const reply = async (
    text: string,
    keyboard?: {
      inline_keyboard: Array<
        Array<{ text: string; callback_data?: string; url?: string }>
      >;
    }
  ) => {
    try {
      await editMessageText(token, {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard ?? { inline_keyboard: [] }, // снять кнопки
      });
    } catch (err) {
      console.warn('[Bot Webhook] review editMessageText failed:', err);
    }
  };

  if (!telegramUserId) {
    await reply('⛔ Не удалось определить пользователя.');
    return;
  }

  // Задача → workspace (источник истины; в callback_data только task id)
  const { data: task } = await supabase
    .from('tasks')
    .select('id, workspace_id, version, column, reviewer_id')
    .eq('id', taskId)
    .maybeSingle();

  if (!task) {
    await reply('⚠️ Задача не найдена.');
    return;
  }

  // Авторизация: активный human-worker workspace задачи (A-08)
  const profileId = await resolveProfileId(telegramUserId);
  if (!profileId) {
    await reply('⛔ Профиль не найден.');
    return;
  }
  const { data: worker } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', task.workspace_id)
    .eq('type', 'human')
    .eq('is_active', true)
    .maybeSingle();
  if (!worker) {
    await reply('⛔ Нет доступа к этой задаче.');
    return;
  }

  const { data: fullId } = await supabase.rpc('task_full_id', {
    p_task_id: taskId,
  });
  const fullIdStr = String(fullId ?? '');

  // ── Миграция 051: двухшаговый возврат на доработку ──────────────────────
  if (action === 'fix') {
    // Задача НЕ двигается: ждём текст причины следующим сообщением.
    const { data: existing } = await supabase
      .from('bot_review_fix_pending')
      .select('id')
      .eq('task_id', taskId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from('bot_review_fix_pending')
        .delete()
        .eq('id', (existing as { id: string }).id);
    }
    await supabase.from('bot_review_fix_pending').insert({
      workspace_id: task.workspace_id,
      task_id: taskId,
      chat_id: chatId,
      card_message_id: messageId ?? 0,
      telegram_user_id: telegramUserId,
    });
    await reply(
      `🔧 <b>${escapeHtml(fullIdStr)}</b>: напишите причиной возврата следующим сообщением.\n\nЗадача будет возвращена агенту вместе с вашим текстом.`,
      {
        inline_keyboard: [
          [{ text: '⬆️ Назад', callback_data: `ra:back:${taskId}` }],
        ],
      }
    );
    return;
  }

  if (action === 'back') {
    // Отмена запроса причины → вернуть карточку ревью с кнопками выбора.
    await supabase
      .from('bot_review_fix_pending')
      .delete()
      .eq('task_id', taskId);
    try {
      await editMessageText(token, {
        chat_id: chatId,
        message_id: messageId,
        text:
          `🔎 Задача <b>${escapeHtml(fullIdStr)}</b> ждет вашей проверки\n\n` +
          'Подтвердите результат или верните на доработку.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Согласовать', callback_data: `ra:approve:${taskId}` }],
            [
              {
                text: '🔧 Вернуть на доработку',
                callback_data: `ra:fix:${taskId}`,
              },
            ],
            [
              {
                text: 'Открыть в приложении',
                url: taskCommentsUrl(fullIdStr),
              },
            ],
          ],
        },
      });
    } catch (err) {
      console.warn('[Bot Webhook] review back editMessageText failed:', err);
    }
    return;
  }

  if (action === 'approve') {
    // Очистить возможный незавершённый запрос причины по этой задаче
    await supabase
      .from('bot_review_fix_pending')
      .delete()
      .eq('task_id', taskId);
  }

  // Атомарный approve/fix с оптимистичной блокировкой по version (INV-09)
  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    'review_action',
    {
      p_task_id: taskId,
      p_action: action,
      p_version: task.version,
      p_actor_worker_id: worker.id,
    }
  );

  const res = (rpcResult ?? {}) as {
    success?: boolean;
    error?: string;
    new_column?: string;
  };

  if (rpcError || !res.success) {
    const errType = res.error || 'error';
    const msg =
      errType === 'already_processed'
        ? '⚠️ Задача уже обработана.'
        : errType === 'version_conflict'
          ? '⚠️ Задача изменилась — откройте доску и проверьте статус.'
          : errType === 'forbidden'
            ? '⛔ Нет доступа.'
            : '⚠️ Не удалось выполнить действие.';
    console.warn(`[Bot Webhook] review_action ${errType} for ${taskId}`);
    await reply(msg);
    return;
  }

  // Аудит ('bot_command' есть в CHECK constraint agent_events.tool)
  await supabase.from('agent_events').insert({
    workspace_id: task.workspace_id,
    tool: 'bot_command',
    agent_name: `telegram_user_${telegramUserId}`,
    task_id: taskId,
    summary: action === 'approve' ? 'review_approved' : 'review_requested_fix',
    metadata: { action, full_id: fullId, actor_worker_id: worker.id },
  });

  const confirmation =
    action === 'approve'
      ? `✅ ${escapeHtml(fullIdStr)} · Согласовано перемещаю в Сделано`
      : `🔧 <b>${escapeHtml(String(fullId ?? ''))}</b> возвращена на доработку → in_progress`;
  await reply(confirmation);
}

// ============================================================================
// Миграция 051: consume pending fix-reason — следующее текстовое сообщение
// пользователя в DM = причина возврата задачи на доработку.
// ============================================================================

async function tryConsumeReviewFixReason(
  chatId: number,
  userId: number,
  rawText: string
): Promise<boolean> {
  const token = BOT_TOKEN;
  const text = rawText.trim();
  if (!token || !text) return false;

  // Ленивая очистка истёкших pending этого чата + старейший валидный
  await supabase
    .from('bot_review_fix_pending')
    .delete()
    .eq('chat_id', chatId)
    .lt('expires_at', new Date().toISOString());
  const { data: pendings } = await supabase
    .from('bot_review_fix_pending')
    .select('id, workspace_id, task_id, card_message_id')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(1);
  const row = (pendings ?? [])[0] as
    | { id: string; workspace_id: string; task_id: string; card_message_id: number }
    | undefined;
  if (!row) return false;

  const finishWithCard = async (
    cardText: string,
    keyboard?: {
      inline_keyboard: Array<
        Array<{ text: string; callback_data?: string; url?: string }>
      >;
    }
  ) => {
    await supabase.from('bot_review_fix_pending').delete().eq('id', row.id);
    if (row.card_message_id) {
      try {
        await editMessageText(token, {
          chat_id: chatId,
          message_id: row.card_message_id,
          text: cardText,
          parse_mode: 'HTML',
          reply_markup: keyboard ?? { inline_keyboard: [] },
        });
      } catch (err) {
        console.warn(
          '[Bot Webhook] fix-reason editMessageText failed:',
          err
        );
      }
    }
  };

  // Авторизация: тот же профиль + активный human-worker workspace задачи (A-08)
  const profileId = await resolveProfileId(userId);
  if (!profileId) {
    await finishWithCard('⛔ Профиль не найден. Начните с /start.');
    return true;
  }
  const { data: worker } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', row.workspace_id)
    .eq('type', 'human')
    .eq('is_active', true)
    .maybeSingle();
  if (!worker) {
    await finishWithCard('⛔ Нет доступа к этой задаче.');
    return true;
  }

  const { data: fullId } = await supabase.rpc('task_full_id', {
    p_task_id: row.task_id,
  });
  const fullIdStr = String(fullId ?? '');
  const reason = text.slice(0, 2000);

  // Свежее состояние задачи: могла измениться, пока пользователь печатал
  const { data: taskRow } = await supabase
    .from('tasks')
    .select('version, column')
    .eq('id', row.task_id)
    .maybeSingle();

  if (!taskRow || taskRow.column !== 'review') {
    await finishWithCard(
      `⚠️ <b>${escapeHtml(fullIdStr)}</b>: задача уже обработана — причина не сохранена.`
    );
    return true;
  }

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    'review_action',
    {
      p_task_id: row.task_id,
      p_action: 'fix',
      p_version: taskRow.version,
      p_actor_worker_id: worker.id,
      p_reason: reason,
    }
  );
  const res = (rpcResult ?? {}) as {
    success?: boolean;
    error?: string;
  };
  if (rpcError || !res.success) {
    const errType = res.error || 'error';
    const msg =
      errType === 'already_processed'
        ? '⚠️ Задача уже обработана.'
        : errType === 'version_conflict'
          ? '⚠️ Задача изменилась — откройте доску и проверьте статус.'
          : errType === 'forbidden'
            ? '⛔ Нет доступа.'
            : '⚠️ Не удалось выполнить действие.';
    console.warn(
      `[Bot Webhook] review_action(fix+reason) ${errType} for ${row.task_id}`
    );
    await finishWithCard(msg);
    return true;
  }

  // Аудит с причиной (видна в get_task_context агента через agent_events)
  await supabase.from('agent_events').insert({
    workspace_id: row.workspace_id,
    tool: 'bot_command',
    agent_name: `telegram_user_${userId}`,
    task_id: row.task_id,
    summary: 'review_requested_fix',
    metadata: {
      action: 'fix',
      full_id: fullIdStr,
      actor_worker_id: worker.id,
      reason,
    },
  });

  await finishWithCard(
    `🔧 <b>${escapeHtml(fullIdStr)}</b> возвращена на доработку\nПричина: ${escapeHtml(reason)}`
  );
  return true;
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
    .select('task_number, created_by, reviewer_id')
    .eq('id', task.id)
    .maybeSingle();

  // Постановщик (created_by) и Проверяющий (reviewer_id) — display_name воркеров
  const namesById = await resolveWorkerNamesByIds([
    taskWithNumber?.created_by as string | null | undefined,
    taskWithNumber?.reviewer_id as string | null | undefined,
  ]);

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
    assignedByName: taskWithNumber?.created_by
      ? namesById.get(taskWithNumber.created_by) ?? null
      : null,
    reviewerName: taskWithNumber?.reviewer_id
      ? namesById.get(taskWithNumber.reviewer_id) ?? null
      : null,
    workspaceHandle: wsWithPrefix?.name || wsWithPrefix?.slug || '',
    clarityScore: aiResult.parse?.clarity_score ?? null,
  };

  const taskCard = buildTaskCard(cardData, 'created');

  // FILE-04: файлы, забуференные до создания задачи (document + caption)
  await attachPendingFilesToTask(task.id, workspaceId, chatId);

  try {
    const sentMsg = await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });
    // FILE-02: reply-маппинг message_id → task_id (для «reply + файл → прикрепить»)
    if (sentMsg?.message_id) {
      await rememberBotTaskMessage({
        supabase,
        workspaceId,
        taskId: task.id,
        chatId,
        messageId: sentMsg.message_id,
      });
    }
  } catch (err) {
    console.error('[Bot Webhook] sendMessage (task card) failed:', err);
    await sendMessage(token, {
      chat_id: chatId,
      text: `✅ Задача создана: ${fullId} · «${task.title}»`,
    }).catch(() => {});
  }
}

/**
 * Resolve worker display names for card fields (assignedByName / reviewerName).
 * Returns a Map keyed by worker id (missing ids are absent from the map).
 */
async function resolveWorkerNamesByIds(
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from('workers')
    .select('id, display_name')
    .in('id', unique);
  return new Map(
    (data ?? []).map((w: { id: string; display_name: string }) => [
      w.id,
      w.display_name,
    ])
  );
}

async function createTaskFallback(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  draftRow: any
): Promise<void> {
  let createdBy: string | null = null;
  let createdByName: string | null = null;
  if (draftRow.user_id) {
    const { data: worker } = await supabase
      .from('workers')
      .select('id, display_name')
      .eq('source_id', draftRow.user_id)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle();
    createdBy = worker?.id ?? null;
    createdByName = worker?.display_name ?? null;
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
    .select('id, title, description, column, priority, version, reviewer_id')
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

  // Проверяющий (reviewer_id) — display_name воркера (обычно null у свежей задачи)
  const reviewerNames = await resolveWorkerNamesByIds([task.reviewer_id]);

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
    assignedByName: createdByName,
    reviewerName: task.reviewer_id
      ? reviewerNames.get(task.reviewer_id) ?? null
      : null,
    workspaceHandle: wsForFallback?.name || wsForFallback?.slug || '',
    clarityScore: null,
  };

  // FILE-04: файлы, забуференные до создания задачи (fallback-путь)
  await attachPendingFilesToTask(task.id, workspaceId, chatId);

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

  void ensureBotCommands();

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
