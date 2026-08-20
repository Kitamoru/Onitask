// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js

// supabase/functions/bot-notify/index.ts — Bot Notify Worker (BOT-10)
// Обработка enrichment_queue записей и отправка уведомлений в Telegram
// bot_.md §6.5
//
// v0.7.0:
// - Исправлены баги: убраны несуществующие колонки task_id/updated_at из запросов,
//   исправлен body Bot API (text вместо html), исправлен escapeHtml (& → &)
// - Добавлена поддержка личных уведомлений (receiver_user_id):
//   alert_type='task_assignment' — исполнителю задачи
//   alert_type='member_added'    — новому участнику workspace

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_USERNAME = Deno.env.get('TELEGRAM_BOT_USERNAME') ?? 'onitaskbot';
const MINI_APP_SHORT_NAME = 'onitask';

serve(async (req) => {
  // Verify authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${Deno.env.get('SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Get pending bot_notify jobs from enrichment_queue
    const jobs = await getPendingJobs();

    for (const job of jobs) {
      await processJob(job);
    }

    return new Response(JSON.stringify({ processed: jobs.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[bot-notify] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Get pending bot_notify jobs from enrichment_queue.
 * NOTE: enrichment_queue has NO task_id or updated_at columns — only id, workspace_id, type, payload, status, scheduled_at, created_at, processed_at, locked_at.
 */
async function getPendingJobs(): Promise<Array<{
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}>> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data } = await supabase
    .from('enrichment_queue')
    .select('id, workspace_id, payload')
    .eq('type', 'bot_notify')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  return (data ?? []) as any;
}

/**
 * Process a single bot_notify job.
 */
async function processJob(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // Mark as processing
  await updateJobStatus(job.id, 'processing');

  try {
    const alertType = (job.payload.alert_type as string) || 'unknown';

    // Personal notifications (task_assignment, member_added) — send to specific user
    if (alertType === 'task_assignment' || alertType === 'member_added') {
      await processPersonalNotification(job, alertType);
    } else {
      // Broadcast notifications — send to all active workspace chats
      const chats = await getActiveChats(job.workspace_id);

      if (!chats.length) {
        await updateJobStatus(job.id, 'done');
        return;
      }

      // Build notification message
      const html = buildNotificationHTML(job);

      // Send to all active chats (broadcast)
      for (const chat of chats) {
        await sendTelegramMessage(chat.chat_id, html);
      }
    }

    // Mark as completed
    await updateJobStatus(job.id, 'done');
  } catch (err) {
    console.error(`[bot-notify] Job ${job.id} error:`, err);
    await updateJobStatus(job.id, 'failed');
  }
}

/**
 * Process personal notification (task_assignment, member_added).
 * Resolves the recipient's telegram_id and sends a direct message.
 */
async function processPersonalNotification(
  job: { id: string; workspace_id: string; payload: Record<string, unknown> },
  alertType: string
): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Resolve worker_id from payload
  const workerId = (job.payload.worker_id as string) || (job.payload.assignee_id as string);
  if (!workerId) {
    console.error(`[bot-notify] Job ${job.id}: no worker_id/assignee_id in payload`);
    return;
  }

  // Get worker's source_id (profiles.id for humans)
  const { data: worker } = await supabase
    .from('workers')
    .select('source_id, display_name, type')
    .eq('id', workerId)
    .maybeSingle();

  if (!worker || worker.type !== 'human') {
    // Agent workers don't have Telegram — skip
    return;
  }

  // Resolve telegram_id from profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('telegram_id')
    .eq('id', worker.source_id)
    .maybeSingle();

  if (!profile?.telegram_id) {
    // User has no Telegram profile — cannot notify
    return;
  }

  // Build message
  let html: string;
  if (alertType === 'task_assignment') {
    html = buildTaskAssignmentHTML(job.payload);
  } else {
    html = buildMemberAddedHTML(job.payload);
  }

  // Send direct message to user's personal chat with bot
  await sendTelegramMessage(profile.telegram_id, html);
}

/**
 * Build HTML for task_assignment notification.
 */
function buildTaskAssignmentHTML(payload: Record<string, unknown>): string {
  const fullId = (payload.full_id as string) || '';
  const title = (payload.title as string) || '';
  const column = (payload.column as string) || 'backlog';
  const priority = (payload.priority as string) || 'medium';

  const columnLabels: Record<string, string> = {
    backlog: 'Бэклог',
    in_progress: 'В работе',
    review: 'На проверке',
    done: 'Готово',
  };
  const priorityLabels: Record<string, string> = {
    low: '🟢 Низкий',
    medium: '🟡 Средний',
    high: '🔴 Высокий',
    critical: '🔴 Критический',
  };

  const lines: string[] = [];
  lines.push(`📋 <b>${escapeHtml(fullId)}</b> — задача назначена на тебя`);
  if (title) lines.push(`«${escapeHtml(title)}»`);
  lines.push('');
  lines.push(`📍 ${columnLabels[column] ?? column}`);
  lines.push(`${priorityLabels[priority] ?? priority} приоритет`);
  lines.push('');
  lines.push(`<a href="${taskDeepLink(fullId)}">Открыть задачу →</a>`);

  return lines.join('\n');
}

/**
 * Build HTML for member_added notification.
 */
function buildMemberAddedHTML(payload: Record<string, unknown>): string {
  const displayName = (payload.display_name as string) || '';
  const role = (payload.role as string) || 'member';

  const roleLabels: Record<string, string> = {
    owner: 'владелец',
    admin: 'администратор',
    member: 'участник',
    viewer: 'наблюдатель',
  };

  const lines: string[] = [];
  lines.push(`👋 <b>${escapeHtml(displayName)}</b>, тебя добавили в рабочее пространство onitask!`);
  lines.push('');
  lines.push(`Роль: ${roleLabels[role] ?? role}`);
  lines.push('');
  lines.push(`<a href="${miniAppDeepLink()}">Открыть доску →</a>`);

  return lines.join('\n');
}

/**
 * Get active telegram chats for a workspace.
 */
async function getActiveChats(workspaceId: string): Promise<Array<{ chat_id: number }>> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data } = await supabase
    .from('workspace_telegram_chats')
    .select('chat_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  return (data ?? []) as any;
}

/**
 * Update job status in enrichment_queue.
 * NOTE: enrichment_queue has NO updated_at column — only status, processed_at, locked_at.
 */
async function updateJobStatus(jobId: string, status: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const updateData: Record<string, unknown> = { status };
  if (status === 'done' || status === 'failed') {
    updateData.processed_at = new Date().toISOString();
  }

  await supabase
    .from('enrichment_queue')
    .update(updateData)
    .eq('id', jobId);
}

/**
 * Build HTML notification message from job payload.
 */
function buildNotificationHTML(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): string {
  const alertType = (job.payload.alert_type as string) || 'unknown';
  const fullId = (job.payload.full_id as string) || '';

  switch (alertType) {
    case 'escalation_alert':
      return `<b>⚠️ Эскалация задачи</b>\n\n${escapeHtml(fullId)} требует внимания.`;

    case 'escalation_resolved':
      return `✅ Эскалация ${escapeHtml(fullId)} снята.\nАгент возобновит работу.`;

    case 'resolution_notify':
      return `<b>🔓 Задача разблокирована</b>\n\n${escapeHtml(fullId)} готова к продолжению.`;

    case 'cascade_unblock':
      return `<b>🔗 Цепочка разблокирована</b>\n\nЗадачи в зависимости от ${escapeHtml(fullId)} готовы.`;

    case 'handoff_chain_alert':
      return `<b>🤝 Handoff передан</b>\n\n${escapeHtml(fullId)} назначен новому исполнителю.`;

    case 'deadline_approaching':
      return `<b>📅 Дедлайн скоро</b>\n\n${escapeHtml(fullId)} — дедлайн через ${(job.payload.hours_left as number) || '?'}ч`;

    default:
      return `<b>📢 Уведомление</b>\n\n${escapeHtml(JSON.stringify(job.payload))}`;
  }
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '\x26amp\x3B')
    .replace(/</g, '\x26lt\x3B')
    .replace(/>/g, '\x26gt\x3B');
}

/**
 * Build Mini App deep link.
 * Format: https://t.me/<bot>/<app>?startapp=<param>
 */
function miniAppDeepLink(startParam?: string): string {
  const base = `https://t.me/${BOT_USERNAME}/${MINI_APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

/**
 * Build task deep link for Mini App.
 * Prefixes full_id with "task_" for start_param routing.
 */
function taskDeepLink(fullId: string): string {
  return miniAppDeepLink(`task_${fullId}`);
}

/**
 * Send message to Telegram via Bot API.
 * chatId can be a group chat_id or a personal user telegram_id.
 */
async function sendTelegramMessage(chatId: number, html: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html.slice(0, 4096),
      parse_mode: 'HTML',
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[bot-notify] Telegram sendMessage failed (chat_id=${chatId}): ${resp.status} ${body}`);
  }
}