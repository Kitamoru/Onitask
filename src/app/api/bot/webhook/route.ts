// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual

import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramWebhookSecret } from '../../../../../lib/bot';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_BOT_SECRET;

/**
 * Dispatch update to appropriate handler based on update type.
 */
async function dispatchUpdate(update: unknown): Promise<void> {
  // TODO: Implement full dispatcher
  // For now, log the update for debugging
  console.log('[Bot Webhook] Received update:', JSON.stringify(update).slice(0, 500));
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
    await dispatchUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Bot Webhook] Dispatch error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}