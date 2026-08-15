// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual
// BOT-05: Lazy workspace selection — no initial board prompt
//          Commands requiring workspace show inline keyboard if not selected
// NO LAST-USED: We don't remember board selection — always ask if multiple boards

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyTelegramWebhookSecret,
  sendMessage,
  sendChatAction,
  answerCallbackQuery,
  editMessageText,
  buildWorkspaceSelectionKeyboard,
  buildWorkspaceSelectedHTML,
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
 * In-memory session store for pending commands.
 * Key: chatId, Value: { command: string, args: string, userId: number }
 * TTL: 5 minutes (cleaned up on use or after timeout)
 */
interface PendingCommand {
  command: string;
  args: string;
  userId: number;
  expiresAt?: number;
}

const pendingCommands = new Map<number, PendingCommand>();

// Cleanup timer: remove expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of pendingCommands.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      pendingCommands.delete(chatId);
    }
  }
}, 60_000);

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
    if (command === 'start') {
      await handleStartCommand(message, args);
      return;
    }

    if (command === 'help') {
      // Show help even without workspace
      await handleCommand(message, command, args, '');
      return;
    }

    // Commands that need workspace — show inline keyboard
    if (COMMANDS_REQUIRING_WORKSPACE.includes(command)) {
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
        await handleCommand(message, command, args, ws.id);
        return;
      }

      // Multiple workspaces — show selection keyboard
      const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces);
      let wsList = `<b>Выбери доску для выполнения команды:</b>\n\n`;
      for (const ws of availableWorkspaces.slice(0, 8)) {
        wsList += `• <code>${escapeHtml(ws.slug)}</code>`;
        if (ws.title) wsList += ` — ${escapeHtml(ws.title)}`;
        wsList += '\n';
      }
      wsList += '\nНажмите кнопку для выбора.';

      // Store pending command for re-execution after workspace selection
      pendingCommands.set(chatId, {
        command,
        args,
        userId,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
      });

      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: wsList.slice(0, 4096),
        reply_markup: keyboard,
      });
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
 * Handle inline button callback queries.
 * Supports: select_ws:<workspace_id>, unblock_task:<task_id>
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

  // Handle workspace selection: select_ws:<workspace_id>
  if (data.startsWith('select_ws:')) {
    const workspaceId = data.replace('select_ws:', '');

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
    const html = buildWorkspaceSelectedHTML(ws.name || ws.slug);
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
    });

    // Re-execute pending command if exists
    const pending = pendingCommands.get(chatId);
    if (pending) {
      // Clear pending
      pendingCommands.delete(chatId);

      // Execute the stored command with the selected workspace
      // We need to reconstruct the message object
      const fakeMessage = {
        chat: { id: chatId },
        from: { id: userId },
        text: `/${pending.command}${pending.args ? ' ' + pending.args : ''}`,
      };
      await handleCommand(fakeMessage as any, pending.command, pending.args, workspaceId);
    }

    console.log(`[Bot Webhook] User ${userId} selected workspace ${ws.slug} (${workspaceId})`);
    return;
  }

  // Handle unblock task: unblock_task:<task_id>
  if (data.startsWith('unblock_task:')) {
    const taskId = data.replace('unblock_task:', '');

    // Get user's last used workspace or resolve
    const wsResult = await resolveWorkspace(userId, chatId, 'private');
    if (!wsResult) {
      await answerCallbackQuery(token, {
        callback_query_id: callbackQuery.id,
        text: '⚠️ Workspace не найден',
        show_alert: true,
      });
      return;
    }

    await handleUnblockTask(taskId, chatId, wsResult.workspace_id);
    return;
  }
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