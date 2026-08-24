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
// v0.7.2:
// - FIX: платформенный SUPABASE_SERVICE_ROLE_KEY не совпадает с копией в vault
//   (ключ ротировался) → cron получал 401. Auth теперь проверяется против
//   выделенного секрета vault 'bot_notify_cron_secret' (timing-safe, INV-06).
// v0.7.3:
// - FIX: PostgREST не экспонирует схему vault → запрос vault.decrypted_secrets
//   из Edge Function падал → снова 401. Секрет читается через SECURITY DEFINER
//   RPC public.get_bot_notify_cron_secret() (миграция 047).
// v0.7.4:
// - FIX: Deno Edge Runtime не имеет глобального Buffer → ReferenceError в
//   timingSafeCompare (500 на каждом вызове). timingSafeCompare переписан на
//   pure-Deno: TextEncoder + XOR, constant-time сохранён (INV-06).
// v0.7.5:
// - NEW: alert_type='task_done' (миграция 048, триггер trg_task_done_notify).
//   При переходе задачи в 'done' постановщику (tasks.created_by) уходит
//   личный DM «Задача выполнена» с reason из последнего move_task события
//   в agent_events. Broadcast в чаты workspace НЕ отправляется.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_USERNAME = Deno.env.get('TELEGRAM_BOT_USERNAME') ?? 'onitaskbot';
const MINI_APP_SHORT_NAME = 'onitask';

/**
 * Timing-safe string comparison (INV-06).
 * Pure-Deno implementation (TextEncoder + XOR): Deno Edge Runtime has no
 * global Buffer and node:crypto may be unavailable in this runtime.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) {
    // Compare against itself to keep constant time, then fail
    let dummy = 0;
    for (let i = 0; i < bufA.length; i++) dummy |= bufA[i] ^ bufA[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

/**
 * Verify Authorization header against vault secret 'bot_notify_cron_secret'.
 * The function itself always has a valid service-role DB client, so it can
 * resolve the expected secret at request time — no dependency on the
 * platform-managed service key value.
 */
async function isAuthorized(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const provided = authHeader.slice('Bearer '.length);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabase.rpc('get_bot_notify_cron_secret');

  if (!data) return false;
  return timingSafeCompare(provided, data as string);
}

serve(async (req) => {
  // Verify authorization header against vault cron secret
  if (!(await isAuthorized(req))) {
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

    // Task done — личный DM только постановщику задачи
    if (alertType === 'task_done') {
      await processTaskDoneNotification(job);
    } else if (alertType === 'task_assignment' || alertType === 'member_added') {
      await processPersonalNotification(job, alertType);
    } else {
      // Broadcast notifications — send to all active workspace chats
      const chats = await getActiveChats(job.workspace_id);

      if (!chats.length) {
        // Fallback: если чаты не привязаны, эскалации уходят личными
        // сообщениями владельцам/админам workspace (иначе уведомления теряются)
        if (alertType === 'escalation_alert' || alertType === 'escalation_resolved') {
          await sendEscalationFallbackDMs(job);
        }
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
 * Process task_done notification: DM только постановщику (created_by).
 * Reason берётся из последнего move_task события в agent_events (если есть).
 *
 * Резолв получателя:
 *   1. created_by (workers.id по схеме 023, либо сразу profiles.id) →
 *      workers.source_id → profiles.telegram_id.
 *   2. Если постановщик недоступен/агентская задача (создана агентом через MCP,
 *      у агента source_id='agent::...') → fallback на admin/owner workspace.
 */
async function processTaskDoneNotification(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const taskId = job.payload.task_id as string | undefined;

  // Резолвим постановщика: из payload, fallback — tasks.created_by (workers.id)
  let createdBy = job.payload.created_by as string | undefined;
  if (!createdBy && taskId) {
    const { data: task } = await supabase
      .from('tasks')
      .select('created_by')
      .eq('id', taskId)
      .maybeSingle();
    createdBy = (task?.created_by as string | undefined) ?? undefined;
  }

  // Резолв telegram_id постановщика (workers.id → source_id → profiles)
  let profileIds: string[] = [];
  if (createdBy) {
    const { data: worker } = await supabase
      .from('workers')
      .select('source_id, type')
      .eq('id', createdBy)
      .maybeSingle();
    if (worker && worker.type === 'human' && worker.source_id) {
      profileIds.push(worker.source_id as string);
    } else {
      // created_by может быть сразу profiles.id — пробуем напрямую
      profileIds.push(createdBy);
    }
  }

  let recipientTelegramIds: number[] = [];
  for (const profileId of [...new Set(profileIds)]) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_id')
      .eq('id', profileId)
      .maybeSingle();
    if (profile?.telegram_id) recipientTelegramIds.push(profile.telegram_id as number);
  }

  // Агентская задача без постановщика → уведомляем admin/owner workspace
  if (recipientTelegramIds.length === 0) {
    const { data: admins } = await supabase
      .from('workers')
      .select('source_id')
      .eq('workspace_id', job.workspace_id)
      .eq('type', 'human')
      .eq('is_active', true)
      .in('role', ['owner', 'admin']);
    for (const admin of admins ?? []) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_id')
        .eq('id', admin.source_id)
        .maybeSingle();
      if (profile?.telegram_id) recipientTelegramIds.push(profile.telegram_id as number);
    }
  }

  if (recipientTelegramIds.length === 0) {
    console.error(
      `[bot-notify] Job ${job.id}: no recipient telegram_id for task_done (created_by=${createdBy ?? 'none'})`
    );
    return;
  }

  // Reason из последнего move_task события агента (опционально)
  let reason = '';
  if (taskId) {
    const { data: events } = await supabase
      .from('agent_events')
      .select('metadata')
      .eq('workspace_id', job.workspace_id)
      .eq('task_id', taskId)
      .eq('tool', 'move_task')
      .order('created_at', { ascending: false })
      .limit(1);
    reason = ((events?.[0]?.metadata as Record<string, unknown>)?.reason as string) || '';
  }

  const html = buildTaskDoneHTML(job.payload, reason);

  for (const telegramId of [...new Set(recipientTelegramIds)]) {
    await sendTelegramMessage(telegramId, html);
  }
}

/**
 * Build HTML for task_done notification.
 */
function buildTaskDoneHTML(payload: Record<string, unknown>, reason: string): string {
  const fullId = (payload.full_id as string) || '';
  const title = (payload.title as string) || '';

  const lines: string[] = [];
  lines.push('✅ <b>Задача выполнена</b>');
  if (fullId) lines.push(`<b>${escapeHtml(fullId)}</b>`);
  if (title) lines.push(`«${escapeHtml(title)}»`);
  if (reason) lines.push('');
  if (reason) lines.push(`Что сделано: ${escapeHtml(reason)}`);
  lines.push('');
  lines.push(`<a href="${taskDeepLink(fullId)}">Открыть задачу →</a>`);

  return lines.join('\n');
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
 * Fallback для эскалаций при отсутствии привязанных чатов:
 * уведомление получает постановщик задачи (tasks.created_by) —
 * он больше всех заинтересован в результате. Если у постановщика
 * нет telegram_id — fallback на owner/admin workspace.
 */
async function sendEscalationFallbackDMs(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const recipientIds: string[] = [];

  // 1. Постановщик задачи — главный заинтересованный в результате
  const taskId = job.payload.task_id as string | undefined;
  if (taskId) {
    const { data: task } = await supabase
      .from('tasks')
      .select('created_by')
      .eq('id', taskId)
      .maybeSingle();
    if (task?.created_by) recipientIds.push(task.created_by as string);
  }

  // 2. Fallback: если постановщик неизвестен — owner/admin workspace
  if (recipientIds.length === 0) {
    const { data: admins } = await supabase
      .from('workers')
      .select('source_id')
      .eq('workspace_id', job.workspace_id)
      .eq('type', 'human')
      .eq('is_active', true)
      .in('role', ['owner', 'admin']);
    for (const admin of admins ?? []) {
      if (admin.source_id) recipientIds.push(admin.source_id as string);
    }
  }

  if (recipientIds.length === 0) return;

  const html = buildNotificationHTML(job);

  for (const profileId of [...new Set(recipientIds)]) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_id')
      .eq('id', profileId)
      .maybeSingle();

    if (profile?.telegram_id) {
      await sendTelegramMessage(profile.telegram_id, html);
    }
  }
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
  const title = (job.payload.title as string) || '';
  const escalationReason = (job.payload.escalation_reason as string) || '';

  switch (alertType) {
    case 'escalation_alert':
      const lines: string[] = [];
      lines.push('🆘 <b>Эскалация задачи</b>');
      if (fullId) lines.push(`<b>${escapeHtml(fullId)}</b>`);
      if (title) lines.push(`«${escapeHtml(title)}»`);
      if (escalationReason) lines.push(`Причина: ${escapeHtml(escalationReason)}`);
      lines.push('');
      lines.push(`<a href="${taskDeepLink(fullId)}">Открыть задачу →</a>`);
      return lines.join('\n');

    case 'escalation_resolved':
      const resLines: string[] = [];
      resLines.push('✅ <b>Эскалация снята</b>');
      if (fullId) resLines.push(`<b>${escapeHtml(fullId)}</b>`);
      if (title) resLines.push(`«${escapeHtml(title)}»`);
      resLines.push('');
      resLines.push('Агент может продолжить работу.');
      resLines.push('');
      resLines.push(`<a href="${taskDeepLink(fullId)}">Открыть задачу →</a>`);
      return resLines.join('\n')

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