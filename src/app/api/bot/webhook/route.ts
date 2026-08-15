// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual
// BOT-05: Lazy workspace selection — no initial board prompt
//          Commands requiring workspace show inline keyboard if not selected
// SERVERLESS-SAFE: No in-memory state — uses DB for drafts, callback_data for commands
//
// Workflow:
//   1. Command without args (/review, /inbox, /flow):
//      callback_data = "select_ws:<wsId>:<command>" → execute in same callback
//   2. /task [text]:
//      INSERT into bot_task_drafts → callback_data = "select_ws:<wsId>:draft"
//      → consume draft + create task in same callback
//   3. /task ALPHA-123 or /resolve ALPHA-123:
//      callback_data = "select_ws:<wsId>:<command>:<fullId>" → execute in same callback

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
} from '../../../../../lib/bot';
import { handleStartCommand } from '../../../../../src/lib/bot/onboarding';
import { handleCommand, handleUnblockTask } from '../../../../../src/lib/bot/commands';
import { resolveWorkspace, getUserAvailableWorkspaces, resolveProfileId } from '../../../../../src/lib/bot/workspaceResolver';
import { checkFreemiumBoundary } from '../../../../../src/lib/bot/freemium';
import { setPendingTask, clearPendingTask, isPendingTaskMode } from '../../../../../src/lib/bot/taskDraft';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_BOT_SECRET;

/**
 * Parse command from message text. Returns [command, args] or null.
 */
function parseCommand(text: string): [string, string] | null {
  const trimmed = text.trim();
  // Handle /command or /command@botname args
  const match = trimmed.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/);
  if (!match) return null;
  return [match[1], match[2] || ''];
}

/**
 * Commands that require workspace selection before execution.
 * These will trigger the inline keyboard if no workspace is resolved.
 */
const COMMANDS_REQUIRING_WORKSPACE = [
  'inbox', 'flow', 'standup', 'stuck', 'review', 'summary',
  'task', 'resolve',
];

/**
 * Commands that work WITHOUT workspace (start, help).
 */
const WORKSPACE_FREE_COMMANDS = ['start', 'help'];

/**
 * Dispatch update to appropriate handler based on update type.
 */
async function dispatchUpdate(update: any): Promise<void> {
  // Handle callback_query (inline button presses)
  const callbackQuery = update.callback_query;
  if (callbackQuery) {
    await handleCallbackQuery(callbackQuery);
    return;
  }

  // Handle message updates
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
    console.log('[Bot Webhook] No user id in message');
    return;
  }

  // Ignore bot messages
  if (chat.type !== 'private') {
    return;
  }

  // Send typing indicator
  if (BOT_TOKEN) {
    await sendChatAction(BOT_TOKEN, { chat_id: chatId, action: 'typing' }).catch(() => {});
  }

  // Step 1: Check if it's a command
  let parsedCommand: [string, string] | null = null;
  if (text && text.startsWith('/')) {
    parsedCommand = parseCommand(text);
  }

  // Step 2: Resolve workspace
  let workspaceResult = await resolveWorkspace(userId, chatId, 'private');

  // If workspace resolved, proceed with command handling
  if (workspaceResult && parsedCommand) {
    const [command, args] = parsedCommand;
    const workspaceId = workspaceResult.workspace_id;

    // Freemium check for restricted commands
    const gateMessage = await checkFreemiumBoundary(command, userId, workspaceId);
    if (gateMessage) {
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: gateMessage,
      });
      return;
    }

    if (command === 'start') {
      await handleStartCommand(message, args);
      return;
    }

    // Route other commands
    await handleCommand(message, command, args, workspaceId);
    return;
  }

  // Step 3: No workspace resolved — check if it's a command
  if (parsedCommand) {
    const [command, args] = parsedCommand;

    // Commands that work without workspace (start, help)
    if (WORKSPACE_FREE_COMMANDS.includes(command)) {
      await handleCommand(message, command, args, '');
      return;
    }

    // Commands that need workspace — show inline keyboard
    if (COMMANDS_REQUIRING_WORKSPACE.includes(command)) {
      await handleCommandRequiringWorkspace(chatId, userId, command, args);
      return;
    }

    // Unknown command — show help
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '⚠️ Неизвестная команда. Введите /help для списка команд.',
    });
    return;
  }

  // Step 4: Regular message — check if user is in "pending task" mode
  // If so, treat this text/voice as the task description → save draft → show board selection
  const pendingActive = await isPendingTaskMode(chatId);

  if (pendingActive) {
    // Resolve profile UUID for DB operations
    const profileId = await resolveProfileId(userId);
    if (!profileId) {
      await clearPendingTask(chatId);
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '⚠️ Профиль не найден. Начните с /start.',
      });
      return;
    }

    // User sent text after /task — create a real draft and show board selection
    let taskText = '';
    let source: string = 'nl';

    if (text && text.trim().length > 0) {
      taskText = text.trim();
      source = 'nl';
    } else if (message.voice) {
      // Voice message — transcribe first
      const voiceFileId = message.voice.file_id;
      const audioUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/file_${voiceFileId}`;
      try {
        const resp = await fetch(audioUrl, {
          headers: { 'Authorization': `Bot ${BOT_TOKEN}` },
        });
        if (resp.ok) {
          const blob = await resp.blob();
          // For MVP: use placeholder transcription (actual STT via /api/ai/transcribe)
          taskText = `[Голосовое сообщение] (транскрибация: ${blob.size} bytes)`;
          source = 'voice';
        }
      } catch (err) {
        console.error('[Bot Webhook] Failed to download voice:', err);
        taskText = '[Голосовое сообщение]';
        source = 'voice';
      }
    }

    if (taskText.length > 0) {
      // Clean up pending marker
      await clearPendingTask(chatId);

      // Create real draft
      const { data: draftResult, error: draftError } = await supabase.rpc('create_bot_task_draft', {
        p_user_id: profileId,
        p_chat_id: chatId,
        p_title: taskText.slice(0, 500),
        p_description: null,
        p_source: source,
      });

      if (draftError || !draftResult) {
        console.error('[Bot Webhook] Failed to create draft from pending:', draftError);
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
        });
        return;
      }

      // Show workspace selection keyboard with draft
      const availableWorkspaces = await getUserAvailableWorkspaces(userId); // getUserAvailableWorkspaces internally resolves profileId
      if (availableWorkspaces.length === 0) {
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: 'У вас нет доступных рабочих пространств.',
        });
        return;
      }

      if (availableWorkspaces.length === 1) {
        // Single workspace — create task immediately
        await executeDraftInWorkspaceByChat(BOT_TOKEN!, chatId, userId, availableWorkspaces[0].id);
        return;
      }

      // Multiple workspaces — show selection
      const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, { draftId: draftResult });
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '✅ Черновик сохранён! Выберите доску:',
        reply_markup: keyboard,
      });
      return;
    }

    // Not text or voice — just send help
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '📝 Пожалуйста, отправьте текст или голосовое сообщение для создания задачи.',
    });
    return;
  }

  // No pending — regular help message
  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: '📝 Отправьте /help для списка команд или используйте бота через TWA.',
  });
}

/**
 * Handle commands that require workspace selection.
 * Uses serverless-safe approach:
 *   - /task [text]: save draft to DB, pass draftId in callback_data
 *   - /task (no args): prompt user to send text/voice → saved as draft
 *   - Other commands: pass command name in callback_data
 *
 * INV: profileId resolved once, reused for all DB calls.
 */
async function handleCommandRequiringWorkspace(
  chatId: number,
  userId: number,
  command: string,
  args: string
): Promise<void> {
  // Resolve profile UUID — canonical path for all DB operations
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

  // Single workspace: auto-select, but still ask for text first for /task
  if (availableWorkspaces.length === 1) {
    const ws = availableWorkspaces[0];

    // /task without args → prompt for text, then save draft + auto-select board
    if (command === 'task' && (!args || args.trim().length === 0)) {
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\nБот сохранит черновик и покажет подтверждение.',
      });
      // Store pending context in a lightweight way: we'll detect the next non-command message
      // by checking if it's a regular text/voice message (handled in dispatchUpdate Step 4)
      await setPendingTask(chatId);
      return;
    }

    // /task with text → create draft directly (single workspace, no selection needed)
    if (command === 'task' && args && args.trim().length > 0) {
      const trimmedArgs = args.trim();
      const looksLikeShortId = /^[A-Z]{2,6}-\d{1,6}$/.test(trimmedArgs);

      if (looksLikeShortId) {
        // /task ALPHA-123 — lookup task
        const fakeMessage = {
          chat: { id: chatId },
          from: { id: userId },
          text: `/task ${trimmedArgs}`,
        };
        await handleCommand(fakeMessage as any, 'task', trimmedArgs, ws.id);
        return;
      }

      // /task [text] — save draft and create immediately (single workspace)
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

      // Consume draft and create task in same workspace (send new message since we can't track lastMessageId)
      await executeDraftInWorkspaceByChat(BOT_TOKEN!, chatId, userId, ws.id);
      return;
    }

    // Other commands with single workspace — execute directly
    const fakeMessage = {
      chat: { id: chatId },
      from: { id: userId },
      text: `/${command}${args ? ' ' + args : ''}`,
    };
    await handleCommand(fakeMessage as any, command, args, ws.id);
    return;
  }

  // /task without args → prompt for text first, board selection happens after draft is saved
  // (regardless of workspace count — user must send text/voice before choosing a board)
  if (command === 'task' && (!args || args.trim().length === 0)) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\nБот сохранит черновик и покажет подтверждение.',
    });
    await setPendingTask(chatId);
    return;
  }

  // Multiple workspaces — show selection keyboard
  let keyboardOptions: { command?: string; draftId?: string } = {};

  if (command === 'task' && args && args.trim().length > 0) {
    // /task [text] — save draft to DB first
    const trimmedArgs = args.trim();

    // Check if args look like a short task ID (e.g., ALPHA-123) vs full text
    const looksLikeShortId = /^[A-Z]{2,6}-\d{1,6}$/.test(trimmedArgs);

    if (looksLikeShortId) {
      // /task ALPHA-123 — treat as short ID, pass in callback_data
      keyboardOptions.command = `task:${trimmedArgs}`;
    } else {
      // /task [long text] — save to DB as draft
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

      keyboardOptions.draftId = draftResult;
    }
  } else if (command === 'resolve' && args && args.trim().length > 0) {
    // /resolve ALPHA-123 — pass fullId in callback_data
    keyboardOptions.command = `resolve:${args.trim()}`;
  } else {
    // All other commands: /review, /inbox, /flow, etc.
    keyboardOptions.command = command;
  }

  const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, keyboardOptions);

  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: 'Выберите доску для выполнения команды:',
    reply_markup: keyboard,
  });
}

/**
 * Handle inline button callback queries.
 * Supports: select_ws:<wsId>, select_ws:<wsId>:<command>, select_ws:<wsId>:draft
 * All processing happens IN THE SAME REQUEST — no pending state needed.
 */
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

  // Answer callback query immediately (Telegram gives 30s timeout)
  await answerCallbackQuery(token, {
    callback_query_id: callbackQuery.id,
  });

  // Parse callback_data
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

  // Get workspace details
  const { data: ws } = await supabase
    .from('workspaces')
    .select('slug, name')
    .eq('id', workspaceId)
    .maybeSingle();

  if (!ws) {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: '⚠️ Рабочее пространство не найдено.',
    });
    return;
  }

  // Update message with confirmation
  await editMessageText(token, {
    chat_id: chatId,
    message_id: messageId,
    text: `✅ Выбрано рабочее пространство: <b>${escapeHtml(ws.name || ws.slug)}</b>`,
    parse_mode: 'HTML',
  });

  // Execute based on type
  if (type === 'command') {
    // Command mode: extra = "command" or "command:arg"
    await executeCommandInWorkspace(token, chatId, userId, workspaceId, extra);
  } else if (type === 'draft') {
    // Draft mode: no extra needed — consume latest draft by chat_id
    await executeDraftInWorkspaceByChat(token, chatId, userId, workspaceId);
  }

  console.log(`[Bot Webhook] User ${userId} selected workspace ${ws.slug} (${workspaceId}), type=${type}, extra=${extra}`);
}

/**
 * Execute a command in the selected workspace (one-phase, no pending state).
 * Handles: review, inbox, flow, stuck, standup, summary, task:<id>, resolve:<id>
 */
async function executeCommandInWorkspace(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  extra: string
): Promise<void> {
  // Parse command and optional arg from extra
  // Format: "command" or "command:arg"
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

/**
 * Execute a task draft in the selected workspace (one-phase, no pending state).
 * Consumes the LATEST draft from DB by chat_id and creates the task.
 * This is the primary path for /task flow with board selection.
 */
async function executeDraftInWorkspaceByChat(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string
): Promise<void> {
  // Consume latest active draft atomically (reads and deletes in one transaction)
  const { data: draft, error } = await supabase.rpc('consume_latest_bot_task_draft', {
    p_chat_id: chatId,
  });

  if (error || !draft || draft.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик не найден или истёк. Пожалуйста, отправьте задачу заново через /task.',
    });
    return;
  }

  const draftRow = draft[0];
  if (!draftRow.title) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик пустой. Пожалуйста, отправьте задачу заново через /task.',
    });
    return;
  }

  // Create task in the selected workspace
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      title: draftRow.title,
      description: draftRow.description || null,
      source: draftRow.source || 'bot',
      is_inbox: false,
      column: 'backlog',
      priority: 'medium',
      version: 0,
    })
    .select('id, title, column, priority, version')
    .single();

  if (taskError || !task) {
    console.error('[Bot Webhook] Failed to create task:', taskError);
    await sendMessage(token, {
      chat_id: chatId,
      text: `⚠️ Не удалось создать задачу: ${taskError?.message || 'неизвестная ошибка'}`,
    });
    return;
  }

  // Get full_id by looking up workspace prefix and task_number
  const { data: wsWithPrefix } = await supabase
    .from('workspaces')
    .select('task_prefix')
    .eq('id', workspaceId)
    .maybeSingle();

  // Get task_number from tasks table
  const { data: taskWithNumber } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsWithPrefix?.task_prefix || '?'}-${taskWithNumber?.task_number || '?'}`;

  // Build task card HTML and confirmation keyboard
  const taskCardHtml = `<b>✅ Задача создана</b>\n\n<b>🔖 ${escapeHtml(fullId)} · «${escapeHtml(task.title)}»</b>\n\n<details>\n<summary>📋 Атрибуты</summary>\n📍 Статус: ${escapeHtml(task.column)}\n🔴 Приоритет: ${escapeHtml(task.priority)}\n</details>`;

  await sendMessage(token, {
    chat_id: chatId,
    text: taskCardHtml,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📋 Открыть в TWA →', url: `/board?task=${fullId}` },
      ]],
    },
  });
}

export async function POST(req: NextRequest) {
  // 1. Verify webhook secret token
  const providedSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');

  if (!WEBHOOK_SECRET) {
    console.error('[Bot Webhook] TELEGRAM_BOT_SECRET not configured');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  if (!providedSecret || !verifyTelegramWebhookSecret(providedSecret, WEBHOOK_SECRET)) {
    console.warn('[Bot Webhook] Invalid secret token');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 2. Parse update payload
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  // 3. Dispatch to handler
  try {
    await dispatchUpdate(update as any);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Bot Webhook] Dispatch error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}