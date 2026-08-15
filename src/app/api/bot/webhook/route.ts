// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual
// BOT-02 §3 Priority 6: Inline-кнопки выбора доступных workspace

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
import { handleCommand } from '../../../../../src/lib/bot/commands';
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
 * Save user's last used workspace in profiles table.
 * This enables Priority 5 (last-used) in workspace resolution.
 */
async function setLastUsedWorkspace(telegramUserId: number, workspaceId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ last_used_workspace_id: workspaceId })
    .eq('telegram_id', telegramUserId);
}

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

  // Step 1: Resolve workspace using 6-priority system
  let workspaceResult = await resolveWorkspace(userId, chatId, 'private');

  if (!workspaceResult) {
    // User has no workspace — show available workspaces with inline buttons
    const availableWorkspaces = await getUserAvailableWorkspaces(userId);

    if (availableWorkspaces.length === 0) {
      // No workspaces at all — show general welcome
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: `👋 Привет! Чтобы начать, введите код рабочего пространства:\n\n/ws_ABC123`,
      });
      return;
    }

    // Show available workspaces with inline keyboard
    const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces);
    let wsList = '<b>🏢 Выберите рабочее пространство:</b>\n\n';
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
    return;
  }

  const workspaceId = workspaceResult.workspace_id;

  // Step 2: Check if it's a command
  if (text && text.startsWith('/')) {
    const parsed = parseCommand(text);
    if (parsed) {
      const [command, args] = parsed;

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
        // Re-use handleStartCommand with workspace code from args
        await handleStartCommand(message, args);
        return;
      }

      // Route other commands
      await handleCommand(message, command, args, workspaceId);
      return;
    }
  }

  // Step 3: Regular message — could be inline task creation
  // For now, show help
  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: '📝 Отправьте /help для списка команд или используйте бота через TWA.',
  });
}

/**
 * Handle inline button callback queries.
 * Supports: select_ws:<workspace_id>
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

    // Save last used workspace
    await setLastUsedWorkspace(userId, workspaceId);

    // Update message with confirmation
    const html = buildWorkspaceSelectedHTML(ws.name || ws.slug);
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
    });

    console.log(`[Bot Webhook] User ${userId} selected workspace ${ws.slug} (${workspaceId})`);
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