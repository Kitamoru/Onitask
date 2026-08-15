// supabase/functions/bot-notify/index.ts — Bot Notify Worker (BOT-10)
// Обработка enrichment_queue записей и отправка уведомлений в Telegram
// bot_.md §6.5

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
 */
async function getPendingJobs(): Promise<Array<{
  id: string;
  workspace_id: string;
  task_id?: string;
  payload: Record<string, unknown>;
}>> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data } = await supabase
    .from('enrichment_queue')
    .select('id, workspace_id, task_id, payload')
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
  task_id?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // Mark as processing
  await updateJobStatus(job.id, 'processing');
  
  try {
    // Get active telegram chats for this workspace
    const chats = await getActiveChats(job.workspace_id);
    
    if (!chats.length) {
      await updateJobStatus(job.id, 'completed');
      return;
    }
    
    // Build notification message
    const html = buildNotificationHTML(job);
    
    // Send to all active chats (broadcast — без receiver_user_id)
    for (const chat of chats) {
      await sendTelegramMessage(chat.chat_id, html);
    }
    
    // Mark as completed
    await updateJobStatus(job.id, 'completed');
  } catch (err) {
    console.error(`[bot-notify] Job ${job.id} error:`, err);
    await updateJobStatus(job.id, 'failed');
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
 */
async function updateJobStatus(jobId: string, status: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  await supabase
    .from('enrichment_queue')
    .update({ 
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

/**
 * Build HTML notification message from job payload.
 */
function buildNotificationHTML(job: {
  id: string;
  workspace_id: string;
  task_id?: string;
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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

/**
 * Send message to Telegram via Bot API.
 * Broadcast — без receiver_user_id (видят все в чате).
 */
async function sendTelegramMessage(chatId: number, html: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      html: html.slice(0, 4096),
      parse_mode: 'HTML',
    }),
  });
}