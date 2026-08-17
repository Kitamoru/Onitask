// src/lib/bot/onboarding.ts — Онбординг через invite (BOT-07)
// /start ws_CODE → welcome Rich Message + worker registration
// v0.6.5 spec: /start task_TASK-123 → lookup task via /run-task flow
//
// FIX: registerWorker теперь использует profile.id как source_id (INV-16).
// findWorkspaceByCode запрашивает invite_links.code вместо workspaces.invite_code.
// logBotEvent использует правильные столбцы agent_events.
// escapeHtml правильно экранирует спецсимволы.

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
 * Resolve profile UUID from Telegram user ID.
 * Creates a profile if it doesn't exist (find-or-create pattern per INV-16).
 */
async function ensureProfile(
  telegramUserId: number,
  firstName: string,
  lastName?: string
): Promise<string | null> {
  // Try to find existing profile
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle();

  if (existing?.id) return existing.id;

  // Create new profile (find-or-create per INV-16)
  const userId = crypto.randomUUID();
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || `User_${telegramUserId}`;

  const { data: newProfile, error: insertError } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      telegram_id: telegramUserId,
      display_name: displayName,
    })
    .select('id')
    .single();

  if (insertError || !newProfile) {
    console.error('[Bot Onboarding] Profile creation error:', insertError);
    return null;
  }

  return newProfile.id;
}

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
  const lastName = msg.from?.last_name;

  // Parse args: check for task deep link first (startapp=task_TASK-123)
  // Format from TWA: "task_ALPHA-123" (prefix added by taskUrl() in lib/bot.ts)
  const taskDeepLinkMatch = args.match(/^task_([A-Z]+-\d+)$/i);
  if (taskDeepLinkMatch) {
    const fullId = taskDeepLinkMatch[1].toUpperCase();
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: {
        html: `🔍 <b>Просмотр задачи ${escapeHtml(fullId)}</b>\n\nИспользуйте команду: <b>/run-task ${escapeHtml(fullId)}</b>`,
      },
    });
    return;
  }

  // Parse workspace code from args (format: ws_CODE or CODE)
  let workspaceCode: string | null = null;
  if (args) {
    // Remove 'ws_' prefix if present
    workspaceCode = args.replace(/^ws_/, '').replace(/^WS_/, '').trim();
  }

  if (!workspaceCode) {
    // No code provided — show general welcome (v0.6.5 spec)
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `
👋 <b>Привет, ${escapeHtml(firstName)}!</b>

Я бот Onitask — ваш AI-помощник для управления задачами.

<b>Команды:</b>
• /create-task [текст] — создать задачу
• /create-task 🎤 — создать задачу голосом
• /run-task TASK-123 — посмотреть задачу

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

  // Ensure profile exists (find-or-create per INV-16)
  const profileId = await ensureProfile(userId, firstName, lastName);
  if (!profileId) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось создать профиль. Попробуйте позже.' },
    });
    return;
  }

  // Register user as worker in this workspace
  await registerWorker(profileId, workspace.id, firstName, lastName);

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
 * Uses invite_links table (not workspaces.invite_code which doesn't exist).
 */
async function findWorkspaceByCode(code: string): Promise<{ id: string; slug: string; title?: string } | null> {
  // Try as invite code first (invite_links.code)
  const { data: byInvite } = await supabase
    .from('invite_links')
    .select('workspace_id, workspaces(slug, name)')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle();

  if (byInvite) {
    return {
      id: byInvite.workspace_id,
      slug: (byInvite as any).workspaces?.slug || '',
      title: (byInvite as any).workspaces?.name || undefined,
    };
  }

  // Try as slug
  const { data: bySlug } = await supabase
    .from('workspaces')
    .select('id, slug, name')
    .ilike('slug', code)
    .limit(1)
    .maybeSingle();

  if (bySlug) {
    return {
      id: bySlug.id,
      slug: bySlug.slug,
      title: bySlug.name || undefined,
    };
  }

  return null;
}

/**
 * Register Telegram user as a worker in the workspace.
 * Uses find-or-create pattern (INV-16).
 * Uses profile.id as source_id (not telegram_user_id).
 */
async function registerWorker(
  profileId: string,
  workspaceId: string,
  firstName: string,
  lastName?: string
): Promise<void> {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || `User_${profileId.slice(0, 8)}`;

  // Check if worker already exists
  const { data: existing } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (existing) {
    // Worker exists — just ensure active
    await supabase
      .from('workers')
      .update({ is_active: true })
      .eq('source_id', profileId)
      .eq('workspace_id', workspaceId);
    return;
  }

  // Create new worker record with correct columns (per 001_init.sql)
  await supabase.from('workers').insert({
    workspace_id: workspaceId,
    source_id: profileId,
    type: 'human',
    role: 'member',
    display_name: displayName,
    is_active: true,
  });
}

/**
 * Log bot event to agent_events table.
 * Uses correct columns per 001_init.sql DDL.
 */
async function logBotEvent(
  telegramUserId: number,
  workspaceId: string,
  tool: string,
  payload: Record<string, unknown>
): Promise<void> {
  // Resolve worker ID for actor reference
  const { data: worker } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', String(telegramUserId))
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  await supabase.from('agent_events').insert({
    workspace_id: workspaceId,
    tool: 'bot_command',
    agent_name: `telegram_user_${telegramUserId}`,
    summary: tool,
    metadata: payload,
  });
}

/**
 * Escape HTML special characters for safe insertion into Telegram messages.
 * Prevents interpretation of <, >, & as Telegram markup.
 * bot_.md v0.5.0, security_.md §4.1
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}