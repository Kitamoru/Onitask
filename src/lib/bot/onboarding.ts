// src/lib/bot/onboarding.ts — Онбординг через invite (BOT-07)
// /start ws_CODE → welcome Rich Message + worker registration
// bot_.md §5.2

import { createClient } from '@supabase/supabase-js';
import { sendRichMessage, buildWelcomeHTML } from '../../../lib/bot';
import type { Message } from '../../../types/telegram';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Handle /start command with optional workspace code.
 * Format: /start ws_ABC123 or just /start
 */
export async function handleStartCommand(
  msg: Message,
  args: string
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  const firstName = msg.from?.first_name || 'Пользователь';

  // Parse workspace code from args (format: ws_CODE or CODE)
  let workspaceCode: string | null = null;
  if (args) {
    // Remove 'ws_' prefix if present
    workspaceCode = args.replace(/^ws_/, '').replace(/^WS_/, '').trim();
  }

  if (!workspaceCode) {
    // No code provided — show general welcome
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `
👋 <b>Привет, ${escapeHtml(firstName)}!</b>

Я бот Onitask — ваш AI-помощник для управления задачами.

<b>Что я умею:</b>
• /task [текст] — создать задачу текстом
• /task 🎤 — создать задачу голосом
• /flow — статус доски
• /standup — дайджест команды

<b>Чтобы начать:</b>
Введите код рабочего пространства:
<code>/ws_ABC123</code>

Или перейдите в TWA и выберите workspace там.
`.trim().slice(0, MAX_MESSAGE_LENGTH) },
    });
    return;
  }

  // Find workspace by invite code or slug
  const workspace = await findWorkspaceByCode(workspaceCode);
  if (!workspace) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `
⚠️ Рабочее пространство <code>${escapeHtml(workspaceCode)}</code> не найдено.

Проверьте код и попробуйте снова.
`.trim() },
    });
    return;
  }

  // Register user as worker in this workspace
  await registerWorker(userId, workspace.id);

  // Send welcome message
  const welcomeHtml = buildWelcomeHTML(workspace.slug);
  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: welcomeHtml.slice(0, MAX_MESSAGE_LENGTH) },
  });

  // Log in agent_events
  await logBotEvent(userId, workspace.id, 'onboarding_complete', {
    telegram_user_id: String(userId),
    workspace_id: workspace.id,
  });
}

/**
 * Find workspace by invite code or slug.
 */
async function findWorkspaceByCode(code: string): Promise<{ id: string; slug: string; title?: string } | null> {
  // Try as invite code first
  const { data: byInvite } = await supabase
    .from('workspaces')
    .select('id, slug, title')
    .eq('invite_code', code)
    .maybeSingle();

  if (byInvite) return byInvite;

  // Try as slug
  const { data: bySlug } = await supabase
    .from('workspaces')
    .select('id, slug, title')
    .ilike('slug', code)
    .maybeSingle();

  return bySlug;
}

/**
 * Register Telegram user as a worker in the workspace.
 * Uses find-or-create pattern (INV-17).
 */
async function registerWorker(
  telegramUserId: number,
  workspaceId: string
): Promise<void> {
  // Check if worker already exists
  const { data: existing } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', String(telegramUserId))
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (existing) {
    // Worker exists — update last_active
    await supabase
      .from('workers')
      .update({ is_active: true, last_active: new Date().toISOString() })
      .eq('source_id', String(telegramUserId))
      .eq('workspace_id', workspaceId);
    return;
  }

  // Create new worker record
  await supabase.from('workers').insert({
    source_id: String(telegramUserId),
    workspace_id: workspaceId,
    source: 'telegram_bot',
    is_active: true,
    display_name: `Telegram User #${telegramUserId}`,
  });
}

/**
 * Log bot event to agent_events table.
 */
async function logBotEvent(
  telegramUserId: number,
  workspaceId: string,
  tool: string,
  payload: Record<string, unknown>
): Promise<void> {
  await supabase.from('agent_events').insert({
    workspace_id: workspaceId,
    actor_type: 'worker',
    actor_id: String(telegramUserId),
    tool,
    payload,
    status: 'success',
  });
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}