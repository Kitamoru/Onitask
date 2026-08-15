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
//      INSERT into bot_task_drafts → callback_data = "select_ws:<wsId>:draft:<draftId>"
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
import { resolveWorkspace, getUserAvailableWorkspaces } from '../../../../../src/lib/bot/workspaceResolver';
import { checkFreemiumBoundary } from '../../../../../src/lib/bot/freemium';
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

  // Step 4: Regular message — could be inline task creation or just text
  // For now, show help
  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: '📝 Отправьте /help для списка команд или используйте бота через TWA.',
  });
}

/**
 * Handle commands that require workspace selection.
 * Uses serverless-safe approach:
 *   - /task [text]: save draft to DB, pass draftId in callback_data
 *   - Other commands: pass command name in callback_data
 */
async function handleCommandRequiringWorkspace(
  chatId: number,
  userId: number,
  command: string,
  args: string
): Promise<void> {
  const availableWorkspaces = await getUserAvailableWorkspaces(userId);

  if (availableWorkspaces.length === 0) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: 'У вас нет доступных рабочих пространств. Введите код через администратора.',
    });
    return;
  }

  if (availableWorkspaces.length === 1) {
    // Auto-select single workspace
    const ws = availableWorkspaces[0];
    const fakeMessage = {
      chat: { id: chatId },
      from: { id: userId },
      text: `/${command}${args ? ' ' + args : ''}`,
    };
    await handleCommand(fakeMessage as any, command, args, ws.id);
    return;
  }

  // Multiple workspaces — show selection keyboard
  let keyboardOptions: { command?: string; draftId?: string } = {};

  if (command === 'task' && args && args.trim().length > 0) {
    // /task [text] — save draft to DB first
    const trimmedArgs = args.trim();
    
    // Check if args look like a short task ID (e.g., ALPHA-123) vs full text
    // Short IDs are typically < 20 chars and contain alphanumeric + hyphen
    const looksLikeShortId = /^[A-Z]{2,6}-\d{1,6}$/.test(trimmedArgs);
    
    if (looksLikeShortId) {
      // /task ALPHA-123 — treat as short ID, pass in callback_data
      keyboardOptions.command = `task:${trimmedArgs}`;
    } else {
      // /task [long text] — save to DB as draft
      const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
        p_user_id: userId,
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
  
  let wsList: string;
  if (keyboardOptions.draftId) {
    wsList = `<b>Выбери доску для задачи:</b>\n\n`;
  } else {
    wsList = `<b>Выбери доску для выполнения команды:</b>\n\n`;
  }
  
  for (const ws of availableWorkspaces.slice(0, 8)) {
    wsList += `• <code>${escapeHtml(ws.slug)}</code>`;
    if (ws.title) wsList += ` — ${escapeHtml(ws.title)}`;
    wsList += '\n';
  }
  wsList += '\nНажмите кнопку для выбора.';

  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: wsList.slice(0, 4096),
    reply_markup: keyboard,
  });
}

/**
 * Handle inline button callback queries.
 * Supports: select_ws:<wsId>, select_ws:<wsId>:<command>, select_ws:<wsId>:draft:<draftId>
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
    // Draft mode: extra = draftId
    await executeDraftInWorkspace(token, chatId, userId, workspaceId, extra);
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
 * Consumes the draft from DB and creates the task.
 */
async function executeDraftInWorkspace(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  draftId: string
): Promise<void> {
  // Consume draft atomically (reads and deletes in one transaction)
  const { data: draft, error } = await supabase.rpc('consume_bot_task_draft', {
    p_draft_id: draftId,
  });

  if (error || !draft || draft.length === 0) {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: (await getLastMessageId(chatId)) ?? undefined,
      text: '⚠️ Черновик не найден или истёк. Пожалуйста, отправьте задачу заново.',
    });
    return;
  }

  const draftRow = draft[0];
  if (!draftRow.title) {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: (await getLastMessageId(chatId)) ?? undefined,
      text: '⚠️ Черновик пустой. Пожалуйста, отправьте задачу заново.',
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
    await editMessageText(token, {
      chat_id: chatId,
      message_id: (await getLastMessageId(chatId)) ?? undefined,
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

  await editMessageText(token, {
    chat_id: chatId,
    message_id: (await getLastMessageId(chatId)) ?? undefined,
    text: taskCardHtml,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📋 Открыть в TWA →', url: `/board?task=${fullId}` },
      ]],
    },
  });
}

/**
 * Helper: get last message ID for a chat (for editing).
 * In production, you'd track this per-message. Here we use a simple approach.
 */
async function getLastMessageId(chatId: number): Promise<number | null> {
  // This is a placeholder — in production, track message_ids when sending
  // For now, we can't reliably get the last message_id without storing it
  // The edit will fail silently if message_id is wrong
  return null;
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