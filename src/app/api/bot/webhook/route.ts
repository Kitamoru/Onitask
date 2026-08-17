// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual
// BOT-05: Lazy workspace selection — no initial board prompt
// SERVERLESS-SAFE: No in-memory state — uses DB for drafts, callback_data for commands
//
// Commands (primary):
//   /create [text]     → save draft → select workspace → F-04 pipeline
//   /task [text]       → same as /create
//   /task TASK-123     → lookup task by full_id
//   /help              → list commands
//   /start             → onboarding
// Aliases (compat):
//   /create-task …     → /create
//   /run-task TASK-123 → /task lookup

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
export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_BOT_SECRET;

/**
 * Parse command from message text. Returns [command, args] or null.
 * Supports: /cmd, /cmd@botname, /cmd args, /create-task, /run-task
 */
function parseCommand(text: string): [string, string] | null {
  const trimmed = text.trim();
  // Allow hyphens in command names (create-task, run-task)
  const match = trimmed.match(
    /^\/([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/
  );
  if (!match) return null;
  return [match[1].toLowerCase(), (match[2] || '').trim()];
}

/** Normalize aliases → canonical command name */
function normalizeCommand(command: string): string {
  switch (command) {
    case 'create-task':
      return 'create';
    case 'run-task':
      return 'task'; // lookup when args look like full_id
    default:
      return command;
  }
}

/**
 * Commands that require workspace selection (create flow).
 */
const COMMANDS_REQUIRING_WORKSPACE = ['create', 'task'];

/**
 * Commands that work WITHOUT workspace.
 */
const WORKSPACE_FREE_COMMANDS = ['start', 'help'];

/**
 * Check if a string looks like a task full_id (e.g., ALPHA-123).
 */
function looksLikeTaskFullId(text: string): boolean {
  return /^[A-Z]{2,6}-\d{1,6}$/.test(text.trim());
}

/**
 * sendChatAction with timeout so a hung Telegram API call cannot kill the whole flow.
 */
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
    console.log('[Bot Webhook] sendChatAction OK');
  } catch (err: any) {
    console.warn(
      '[Bot Webhook] sendChatAction failed/timeout:',
      err?.message || String(err)
    );
  }
}

/**
 * Dispatch update to appropriate handler based on update type.
 */
async function dispatchUpdate(update: any): Promise<void> {
  const cb = update.callback_query;
  const msg = update.message || update.edited_message;

  if (cb) {
    console.log(
      '[Bot Webhook] UPDATE type=callback_query id=' +
        cb.id +
        ' data=' +
        (cb.data ?? 'null') +
        ' from_user=' +
        (cb.from?.id ?? '?')
    );
  } else if (msg) {
    console.log(
      '[Bot Webhook] UPDATE type=message chat=' +
        msg.chat?.id +
        ' type=' +
        msg.chat?.type +
        ' text=' +
        (msg.text ?? '[voice]') +
        ' from=' +
        (msg.from?.id ?? '?')
    );
  } else {
    console.log('[Bot Webhook] UPDATE type=unknown (no callback_query, no message)');
  }

  // Handle callback_query
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

  const chat = message.chat;
  const chatId = chat.id;
  const text = message.text;
  const userId = message.from?.id;

  if (!userId) {
    console.error(
      '[Bot Webhook] ERROR No user id in message:',
      JSON.stringify(message).slice(0, 500)
    );
    return;
  }

  if (chat.type !== 'private') {
    console.log('[Bot Webhook] Ignoring non-private chat: type=' + chat.type);
    return;
  }

  console.log('[Bot Webhook] before sendChatAction');
  await safeSendChatAction(chatId);

  // Parse command
  let parsedCommand: [string, string] | null = null;
  if (text && text.startsWith('/')) {
    parsedCommand = parseCommand(text);
  }

  if (parsedCommand) {
    const [rawCmd, args] = parsedCommand;
    const command = normalizeCommand(rawCmd);
    parsedCommand = [command, args];
    console.log(
      '[Bot Webhook] parsedCommand=',
      command,
      'args=',
      JSON.stringify(args),
      'raw=',
      rawCmd
    );
  } else {
    console.log('[Bot Webhook] parsedCommand= null');
  }

  // ── /start FIRST — never depends on workspace / profile ──
  if (parsedCommand && parsedCommand[0] === 'start') {
    const [, args] = parsedCommand;
    console.log('[Bot Webhook] Handling /start (workspace-free path)');
    try {
      await handleStartCommand(message, args);
      console.log('[Bot Webhook] handleStartCommand DONE');
    } catch (err) {
      console.error('[Bot Webhook] ERROR handleStartCommand:', err);
      if (BOT_TOKEN) {
        await sendMessage(BOT_TOKEN, {
          chat_id: chatId,
          text: '⚠️ Ошибка при обработке /start.',
        }).catch(() => {});
      }
    }
    return;
  }

  // ── /task TASK-123 or /run-task TASK-123 → lookup (no workspace needed) ──
  if (parsedCommand && parsedCommand[0] === 'task' && looksLikeTaskFullId(parsedCommand[1])) {
    const fullId = parsedCommand[1].trim().toUpperCase();
    console.log('[Bot Webhook] Task lookup:', fullId);
    await handleResolveTask(BOT_TOKEN!, chatId, userId, message.message_id, fullId);
    return;
  }

  // ── /help without workspace ──
  if (parsedCommand && parsedCommand[0] === 'help') {
    console.log('[Bot Webhook] Handling /help (workspace-free path)');
    try {
      await handleCommand(message, 'help', parsedCommand[1], '');
    } catch (err) {
      console.error('[Bot Webhook] ERROR handleCommand (help):', err);
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text:
          '📋 Команды:\n' +
          '/create [текст] — создать задачу\n' +
          '/task [текст] — создать задачу\n' +
          '/task ALPHA-123 — показать задачу\n' +
          '/help — эта справка',
      });
    }
    return;
  }

  // Step 2: Resolve workspace
  let workspaceResult: { workspace_id: string } | null;
  console.log(
    '[Bot Webhook] >>> About to call resolveWorkspace, userId=' +
      userId +
      ', chatId=' +
      chatId
  );
  try {
    console.log('[Bot Webhook] >>> resolveWorkspace START');
    workspaceResult = await resolveWorkspace(userId, chatId, 'private');
    console.log(
      '[Bot Webhook] >>> resolveWorkspace DONE, result=' +
        (workspaceResult ? 'found' : 'null') +
        ', userId=' +
        userId
    );
  } catch (err: any) {
    console.error(
      '[Bot Webhook] >>> resolveWorkspace THREW ERROR:',
      err?.message || String(err)
    );
    console.error('[Bot Webhook] >>> resolveWorkspace STACK:', err?.stack || 'no stack');
    workspaceResult = null;
  }

  // Workspace resolved + command
  if (workspaceResult && parsedCommand) {
    const [command, args] = parsedCommand;
    const workspaceId = workspaceResult.workspace_id;

    // Create flow with single workspace → still go through draft helper
    // (handleCommand may not know about /create aliases)
    if (command === 'create' || (command === 'task' && !looksLikeTaskFullId(args))) {
      const gateMessage = await checkFreemiumBoundary('create-task', userId, workspaceId);
      if (gateMessage) {
        await sendMessage(BOT_TOKEN!, { chat_id: chatId, text: gateMessage });
        return;
      }
      // Re-use workspace-requiring handler (handles 1 or N boards)
      await handleCommandRequiringWorkspace(chatId, userId, 'create', args);
      return;
    }

    const gateMessage = await checkFreemiumBoundary(command, userId, workspaceId);
    if (gateMessage) {
      await sendMessage(BOT_TOKEN!, { chat_id: chatId, text: gateMessage });
      return;
    }

    try {
      await handleCommand(message, command, args, workspaceId);
    } catch (err) {
      console.error('[Bot Webhook] ERROR handleCommand (' + command + '):', err);
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '⚠️ Ошибка при выполнении команды.',
      });
    }
    return;
  }

  // Step 3: No workspace resolved — command still present
  if (parsedCommand) {
    const [command, args] = parsedCommand;

    if (WORKSPACE_FREE_COMMANDS.includes(command)) {
      console.log('[Bot Webhook] Workspace-free command:', command);
      await handleCommand(message, command, args, '');
      return;
    }

    // /create or /task [text] → need board selection
    if (
      COMMANDS_REQUIRING_WORKSPACE.includes(command) &&
      !(command === 'task' && looksLikeTaskFullId(args))
    ) {
      await handleCommandRequiringWorkspace(chatId, userId, 'create', args);
      return;
    }

    // Unknown
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text:
        '⚠️ Неизвестная команда.\n\n' +
        '/create [текст] — создать задачу\n' +
        '/task [текст] — создать задачу\n' +
        '/task ALPHA-123 — показать задачу\n' +
        '/help — справка',
    });
    return;
  }

  // Step 4: Regular message — pending task mode?
  const pendingActive = await isPendingTaskMode(chatId);
  console.log(
    '[Bot Webhook] Step 4: pendingActive=',
    pendingActive,
    'chatId=',
    chatId,
    'textLen=',
    text?.length,
    'hasVoice=',
    !!message?.voice
  );

  if (pendingActive) {
    const profileId = await resolveProfileId(userId);
    console.log('[Bot Webhook] Step 4: profileId=', profileId);
    if (!profileId) {
      await clearPendingTask(chatId);
      await sendMessage(BOT_TOKEN!, {
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
      if (message.caption && message.caption.trim().length > 0) {
        taskText = message.caption.trim();
        source = 'voice_with_caption';
      } else {
        const voiceFileId = message.voice.file_id;
        const telegramFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/file_${voiceFileId}`;
        try {
          const resp = await fetch(telegramFileUrl, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
          });
          if (resp.ok) {
            const blob = await resp.blob();
            const formData = new FormData();
            formData.append('file', blob, 'voice.ogg');
            const sttResp = await fetch('/api/ai/transcribe', {
              method: 'POST',
              body: formData,
            });
            if (sttResp.ok) {
              const sttData = await sttResp.json();
              taskText = sttData.text || `[Голосовое сообщение]`;
              source = 'voice';
            } else {
              console.warn('[Bot Webhook] STT failed, using placeholder');
              taskText = '[Голосовое сообщение — текст недоступен]';
              source = 'voice';
            }
          }
        } catch (err) {
          console.error('[Bot Webhook] Failed to download/transcribe voice:', err);
          taskText = '[Голосовое сообщение — текст недоступен]';
          source = 'voice';
        }
      }
    }

    if (taskText.length > 0) {
      console.log(
        '[Bot Webhook] Step 4: Creating draft, taskText=',
        taskText.slice(0, 100),
        'source=',
        source
      );
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
        console.error('[Bot Webhook] Failed to create draft from pending:', draftError);
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: '⚠️ Не удалось сохранить черновик. Отправьте задачу заново через /create.',
        });
        return;
      }

      console.log('[Bot Webhook] Draft created successfully, draftId=', draftResult);

      const availableWorkspaces = await getUserAvailableWorkspaces(userId);
      console.log(
        '[Bot Webhook] Step 4: availableWorkspaces count=',
        availableWorkspaces.length
      );

      if (availableWorkspaces.length === 0) {
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: 'У вас нет доступных рабочих пространств.',
        });
        return;
      }

      if (availableWorkspaces.length === 1) {
        await executeDraftInWorkspaceByChat(
          BOT_TOKEN!,
          chatId,
          userId,
          availableWorkspaces[0].id
        );
        return;
      }

      const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, {
        draftId: draftResult,
      });
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '✅ Черновик сохранён! Выберите доску:',
        reply_markup: keyboard,
      });
      return;
    }

    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '📝 Пожалуйста, отправьте текст или голосовое сообщение для создания задачи.',
    });
    return;
  }

  // No pending — regular help
  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text:
      '📝 Команды:\n' +
      '/create [текст] — создать задачу\n' +
      '/task [текст] — создать задачу\n' +
      '/task ALPHA-123 — показать задачу\n' +
      '/help — справка',
  });
}

/**
 * Handle commands that require workspace selection (create flow).
 * command is always normalized to 'create' here.
 */
async function handleCommandRequiringWorkspace(
  chatId: number,
  userId: number,
  command: string,
  args: string
): Promise<void> {
  const profileId = await resolveProfileId(userId);
  if (!profileId) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '⚠️ Профиль не найден. Начните с /start.',
    });
    return;
  }

  const availableWorkspaces = await getUserAvailableWorkspaces(userId);
  if (availableWorkspaces.length === 0) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: 'У вас нет доступных рабочих пространств. Введите код через администратора.',
    });
    return;
  }

  // Single workspace
  if (availableWorkspaces.length === 1) {
    const ws = availableWorkspaces[0];

    if (!args || args.trim().length === 0) {
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text:
          '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\n' +
          'Бот сохранит черновик и создаст задачу.',
      });
      await setPendingTask(chatId, profileId);
      return;
    }

    const trimmedArgs = args.trim();
    const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
      p_user_id: profileId,
      p_chat_id: chatId,
      p_title: trimmedArgs.slice(0, 500),
      p_description: null,
      p_source: 'nl',
    });
    if (error || !draftResult) {
      console.error('[Bot Webhook] Failed to create draft:', error);
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
      });
      return;
    }
    await executeDraftInWorkspaceByChat(BOT_TOKEN!, chatId, userId, ws.id);
    return;
  }

  // Multiple workspaces — no args → pending + ask for text first
  if (!args || args.trim().length === 0) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text:
        '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\n' +
        'Бот сохранит черновик и предложит выбрать доску.',
    });
    await setPendingTask(chatId, profileId);
    return;
  }

  // Multiple + text → draft then keyboard
  const trimmedArgs = args.trim();
  const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
    p_user_id: profileId,
    p_chat_id: chatId,
    p_title: trimmedArgs.slice(0, 500),
    p_description: null,
    p_source: 'nl',
  });
  if (error || !draftResult) {
    console.error('[Bot Webhook] Failed to create draft:', error);
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
    });
    return;
  }

  const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, {
    draftId: draftResult,
  });
  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: '✅ Черновик сохранён! Выберите доску:',
    reply_markup: keyboard,
  });
}

async function handleCallbackQuery(callbackQuery: any): Promise<void> {
  const token = BOT_TOKEN!;
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const userId = callbackQuery.from?.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQuery.id,
      text: 'Неизвестная ошибка',
      show_alert: true,
    });
    return;
  }

  try {
    await answerCallbackQuery(token, { callback_query_id: callbackQuery.id });
  } catch (err) {
    console.warn('[Bot Webhook] answerCallbackQuery failed (stale callback):', err);
  }

  const parsed = parseWorkspaceCallbackData(data);
  if (!parsed.workspaceId) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQuery.id,
      text: 'Неверный формат кнопки',
      show_alert: true,
    });
    return;
  }

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
    await executeCommandInWorkspace(token, chatId, userId, workspaceId, extra);
  } else if (type === 'draft') {
    await executeDraftInWorkspaceByChat(token, chatId, userId, workspaceId);
  }

  console.log(
    `[Bot Webhook] User ${userId} selected workspace ${wsData?.slug || ''} (${workspaceId}), type=${type}, extra=${extra}`
  );
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
  console.log('[Bot Webhook] executeDraftInWorkspaceByChat:', {
    chatId,
    userId,
    workspaceId,
  });

  const { data: draft, error } = await supabase.rpc('consume_latest_bot_task_draft', {
    p_chat_id: chatId,
  });

  if (error || !draft || draft.length === 0) {
    console.warn('[Bot Webhook] Draft not found or expired:', { chatId, error });
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик не найден или истёк. Отправьте задачу заново через /create.',
    });
    return;
  }

  const draftRow = draft[0];
  if (!draftRow.title) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик пустой. Отправьте задачу заново через /create.',
    });
    return;
  }

  const taskText = draftRow.title;

  let aiResult: {
    task?: { id: string; title: string; column: string; priority: string };
    parse?: { rewritten_title?: string; clarity_score?: number };
    showCorrectionSheet?: boolean;
  };

  try {
    const resp = await fetch('/api/bot/create-task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        telegram_user_id: userId,
        workspace_id: workspaceId,
        text: taskText,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      console.error('[Bot Webhook] /api/bot/create-task failed:', resp.status, errBody);
      throw new Error(errBody.error || `HTTP ${resp.status}`);
    }

    aiResult = await resp.json();
  } catch (err) {
    console.error('[Bot Webhook] F-04 create-task call failed:', err);
    await createTaskFallback(token, chatId, userId, workspaceId, draftRow);
    return;
  }

  const task = aiResult.task;
  if (!task) {
    console.error('[Bot Webhook] No task returned from F-04');
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Задача не создана. Попробуйте ещё раз.',
    });
    return;
  }

  const { data: wsWithPrefix } = await supabase
    .from('workspaces')
    .select('task_prefix, slug')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: taskWithNumber } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsWithPrefix?.task_prefix || '?'}-${taskWithNumber?.task_number || '?'}`;
  console.log('[Bot Webhook] Task created via F-04:', {
    taskId: task.id,
    fullId,
    chatId,
  });

  const cardData: TaskCardData = {
    fullId,
    title: task.title,
    column: task.column,
    isInbox: false,
    isBlocked: false,
    priority: task.priority as 'high' | 'medium' | 'low' | null,
    dueDate: null,
    assigneeName: null,
    workspaceHandle: wsWithPrefix?.slug || '',
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
    try {
      await sendMessage(token, {
        chat_id: chatId,
        text: `✅ Задача создана: ${fullId} · «${task.title}»`,
      });
    } catch (err2) {
      console.error('[Bot Webhook] sendMessage (fallback) failed:', err2);
    }
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
      source: draftRow.source || 'bot',
      created_by: createdBy,
      is_inbox: false,
      column: 'backlog',
      priority: 'medium',
      version: 0,
    })
    .select('id, title, column, priority, version')
    .single();

  if (taskError || !task) {
    console.error('[Bot Webhook] Fallback task creation failed:', taskError);
    await sendMessage(token, {
      chat_id: chatId,
      text: `⚠️ Не удалось создать задачу: ${taskError?.message || 'неизвестная ошибка'}`,
    });
    return;
  }

  const { data: wsForFallback } = await supabase
    .from('workspaces')
    .select('task_prefix, slug')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: taskWithNumber2 } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsForFallback?.task_prefix || '?'}-${taskWithNumber2?.task_number || '?'}`;
  console.log('[Bot Webhook] Task created via fallback:', {
    taskId: task.id,
    fullId,
    chatId,
  });

  const cardData: TaskCardData = {
    fullId,
    title: task.title,
    column: task.column,
    isInbox: false,
    isBlocked: false,
    priority: task.priority as 'high' | 'medium' | 'low' | null,
    dueDate: null,
    assigneeName: null,
    workspaceHandle: wsForFallback?.slug || '',
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
      console.error('[Bot Webhook] get_task_card_data_by_full_id error:', rpcError);
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
    console.error('[Bot Webhook] TELEGRAM_BOT_SECRET not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (!providedSecret || !verifyTelegramWebhookSecret(providedSecret, WEBHOOK_SECRET)) {
    console.warn('[Bot Webhook] Invalid secret token');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Bot Webhook] env check', {
    hasToken: !!BOT_TOKEN,
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

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
