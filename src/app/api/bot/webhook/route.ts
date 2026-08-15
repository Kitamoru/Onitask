// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual

import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramWebhookSecret, sendMessage, sendChatAction } from '../../../../../lib/bot';
import { handleStartCommand } from '../../../../../src/lib/bot/onboarding';
import { handleCommand } from '../../../../../src/lib/bot/commands';
import { resolveWorkspace, getUserAvailableWorkspaces } from '../../../../../src/lib/bot/workspaceResolver';
import { checkFreemiumBoundary } from '../../../../../src/lib/bot/freemium';

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
 * Dispatch update to appropriate handler based on update type.
 */
async function dispatchUpdate(update: any): Promise<void> {
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
    // User has no workspace — show available workspaces or general welcome
    const availableWorkspaces = await getUserAvailableWorkspaces(userId);
    
    if (availableWorkspaces.length === 0) {
      // No workspaces at all — show general welcome
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: `👋 Привет! Чтобы начать, введите код рабочего пространства:\n\n/ws_ABC123`,
      });
      return;
    }

    // Show available workspaces
    let wsList = '<b>Выберите рабочее пространство:</b>\n\n';
    for (const ws of availableWorkspaces.slice(0, 5)) {
      wsList += `<code>${ws.slug}</code>`;
      if (ws.title) wsList += ` — ${ws.title}`;
      wsList += '\n';
    }
    wsList += '\nИли используйте код: /ws_CODE';

    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: wsList.slice(0, 4096),
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