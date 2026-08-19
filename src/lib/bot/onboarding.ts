// src/lib/bot/onboarding.ts — Онбординг через invite (BOT-07)
// /start ws_CODE → welcome + worker registration
// /start task_TASK-123 → подсказка /call

import { createClient } from '@supabase/supabase-js';
import { sendRichMessage, buildWelcomeHTML, escapeHtml } from '../../../lib/bot';
import type { Message } from '../../../types/telegram';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_MESSAGE_LENGTH = 4096;

const COMMANDS_BLOCK =
  `<b>Команды:</b>\n` +
  `/task — создать задачу (текст или голос)\n` +
  `/call TASK-123 — показать задачу\n` +
  `/backlog — задачи без исполнителя\n` +
  `/help — справка`;

async function ensureProfile(
  telegramUserId: number,
  firstName: string,
  lastName?: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const userId = crypto.randomUUID();
  const displayName =
    [firstName, lastName].filter(Boolean).join(' ') || `User_${telegramUserId}`;

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

export async function handleStartCommand(msg: Message, args: string): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  const firstName = msg.from?.first_name || 'Пользователь';
  const lastName = msg.from?.last_name;

  // Deep link: task_ALPHA-123
  const taskDeepLinkMatch = args.match(/^task_([A-Z]+-\d+)$/i);
  if (taskDeepLinkMatch) {
    const fullId = taskDeepLinkMatch[1].toUpperCase();
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: {
        html:
          `🔍 <b>Просмотр задачи ${escapeHtml(fullId)}</b>\n\n` +
          `Используйте команду: <b>/call ${escapeHtml(fullId)}</b>`,
      },
    });
    return;
  }

  let workspaceCode: string | null = null;
  if (args) {
    workspaceCode = args.replace(/^ws_/i, '').trim();
  }

  if (!workspaceCode) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: {
        html: `
👋 <b>Привет, ${escapeHtml(firstName)}!</b>

Я бот Onitask — AI-помощник для управления задачами.

${COMMANDS_BLOCK}

<b>Чтобы начать:</b>
Введите код рабочего пространства:
<code>/start ws_ABC123</code>
Или перейдите в приложение и выберите workspace там.
`.trim().slice(0, MAX_MESSAGE_LENGTH),
      },
    });
    return;
  }

  const workspace = await findWorkspaceByCode(workspaceCode);
  if (!workspace) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: {
        html: `
⚠️ Рабочее пространство <code>${escapeHtml(workspaceCode)}</code> не найдено.

Проверьте код и попробуйте снова.
`.trim(),
      },
    });
    return;
  }

  const profileId = await ensureProfile(userId, firstName, lastName);
  if (!profileId) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось создать профиль. Попробуйте позже.' },
    });
    return;
  }

  await registerWorker(profileId, workspace.id, firstName, lastName);

  const welcomeHtml = buildWelcomeHTML(workspace.slug);
  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: welcomeHtml.slice(0, MAX_MESSAGE_LENGTH) },
  });

  await logBotEvent(userId, workspace.id, 'onboarding_complete', {
    telegram_user_id: String(userId),
    workspace_id: workspace.id,
  });
}

async function findWorkspaceByCode(
  code: string
): Promise<{ id: string; slug: string; title?: string } | null> {
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

async function registerWorker(
  profileId: string,
  workspaceId: string,
  firstName: string,
  lastName?: string
): Promise<void> {
  const displayName =
    [firstName, lastName].filter(Boolean).join(' ') ||
    `User_${profileId.slice(0, 8)}`;

  const { data: existing } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('workers')
      .update({ is_active: true })
      .eq('source_id', profileId)
      .eq('workspace_id', workspaceId);
    return;
  }

  await supabase.from('workers').insert({
    workspace_id: workspaceId,
    source_id: profileId,
    type: 'human',
    role: 'member',
    display_name: displayName,
    is_active: true,
  });
}

async function logBotEvent(
  telegramUserId: number,
  workspaceId: string,
  tool: string,
  payload: Record<string, unknown>
): Promise<void> {
  await supabase.from('agent_events').insert({
    workspace_id: workspaceId,
    tool: 'bot_command',
    agent_name: `telegram_user_${telegramUserId}`,
    summary: tool,
    metadata: payload,
  });
}
