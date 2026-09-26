// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
// supabase/functions/bot-notify/index.ts — Bot Notify Worker (BOT-10)
// Unified task-card UI (assignment template) on top of production v0.7.x
//
// Auth: vault secret via RPC get_bot_notify_cron_secret (timing-safe, INV-06)
// Cards: full_id in headers, blockquote body, inline open button always
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildTaskNotifyCard,
  escapeHtml,
  miniAppDeepLink,
  flowDeepLink,
  taskCommentsDeepLink,
  taskDeepLink,
  CARD_CONFIG,
  type NotifyContext,
  type TaskCardData,
} from './card.ts';


const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_USERNAME = Deno.env.get('TELEGRAM_BOT_USERNAME') ?? 'onitaskbot';
CARD_CONFIG.botUsername = BOT_USERNAME;
const MINI_APP_SHORT_NAME = 'onitask';

/**
 * Timing-safe string comparison (INV-06).
 * Pure-Deno (TextEncoder + XOR) — no global Buffer.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) {
    let dummy = 0;
    for (let i = 0; i < bufA.length; i++) dummy |= bufA[i] ^ bufA[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

/**
 * Verify Authorization against vault secret 'bot_notify_cron_secret'
 * via SECURITY DEFINER RPC public.get_bot_notify_cron_secret().
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
  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const jobs = await getPendingJobs();
    for (const job of jobs) {
      await processJob(job);
    }
    // MCP-15 / FILE-01: consumer исходящей очереди агента
    // (проброс send_message_to_chat + файлов в Telegram)
    const queueSent = await drainTelegramMessageQueue();
    return new Response(
      JSON.stringify({ processed: jobs.length, queueSent }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('[bot-notify] Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ============================================================================
// Queue
// ============================================================================

async function getPendingJobs(): Promise<
  Array<{
    id: string;
    workspace_id: string;
    payload: Record<string, unknown>;
  }>
> {
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

async function processJob(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await updateJobStatus(job.id, 'processing');
  try {
    const alertType = (job.payload.alert_type as string) || 'unknown';

    if (alertType === 'task_done') {
      await processTaskDoneNotification(job);
    } else if (alertType === 'task_started') {
      await processTaskStartedNotification(job);
    } else if (alertType === 'task_review') {
      await processTaskReviewNotification(job);
    } else if (alertType === 'deadline_approaching') {
      await processDeadlineNotification(job);
    } else if (
      alertType === 'task_assignment' ||
      alertType === 'member_added'
    ) {
      await processPersonalNotification(job, alertType);
    } else {
      // Broadcast to workspace chats
      const chats = await getActiveChats(job.workspace_id);
      if (!chats.length) {
        if (
          alertType === 'escalation_alert' ||
          alertType === 'escalation_resolved'
        ) {
          await sendEscalationFallbackDMs(job);
        }
        await updateJobStatus(job.id, 'done');
        return;
      }
      const cardMsg = await buildBroadcastCard(job);
      for (const chat of chats) {
        await sendTelegramMessage(
          chat.chat_id,
          cardMsg.text,
          cardMsg.replyMarkup
        );
      }
    }

    await updateJobStatus(job.id, 'done');
  } catch (err) {
    console.error(`[bot-notify] Job ${job.id} error:`, err);
    await updateJobStatus(job.id, 'failed');
  }
}

// ============================================================================
// Personal: assignment / member_added
// ============================================================================

async function processPersonalNotification(
  job: { id: string; workspace_id: string; payload: Record<string, unknown> },
  alertType: string
): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const workerId =
    (job.payload.worker_id as string) || (job.payload.assignee_id as string);
  if (!workerId) {
    console.error(
      `[bot-notify] Job ${job.id}: no worker_id/assignee_id in payload`
    );
    return;
  }

  const { data: worker } = await supabase
    .from('workers')
    .select('source_id, display_name, type')
    .eq('id', workerId)
    .maybeSingle();

  if (!worker || worker.type !== 'human') {
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('telegram_id')
    .eq('id', worker.source_id)
    .maybeSingle();

  if (!profile?.telegram_id) {
    return;
  }

  if (alertType === 'task_assignment') {
    const card = await buildTaskCardData(job, {
      assigneeNameFallback: worker.display_name || null,
    });
    const taskCard = buildTaskNotifyCard(card, 'assigned');
    await sendTelegramMessage(
      profile.telegram_id,
      taskCard.text,
      taskCard.replyMarkup
    );
  } else {
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('slug')
      .eq('id', job.workspace_id)
      .maybeSingle();
    const html = buildMemberAddedHTML(job.payload);
    await sendTelegramMessage(profile.telegram_id, html, {
      inline_keyboard: [
        [{
          text: 'Открыть доску',
          url: workspace?.slug ? flowDeepLink(workspace.slug) : miniAppDeepLink(),
        }],
      ],
    });
  }
}

// ============================================================================
// deadline_approaching — DM постановщику + исполнителю (миг. 090, светофор).
// Дедуп на стороне эмиттера (task_deadline_notifications), здесь — доставка.
// ============================================================================

async function processDeadlineNotification(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const recipients = await resolveTaskRecipients(job, {
    preferReviewer: false,
    preferCreator: true,
    // Постановщик + исполнитель (аналог done_approved, миг. 086)
    alsoAssignee: job.payload.assigned_to as string | undefined,
  });
  if (!recipients.length) {
    console.error(
      `[bot-notify] Job ${job.id}: no recipient telegram_id for deadline_approaching (created_by=${job.payload.created_by ?? 'none'}, assigned_to=${job.payload.assigned_to ?? 'none'})`
    );
    return;
  }

  const card = await buildTaskCardData(job, {});
  // overdue: явный level ИЛИ дедлайн уже прошёл (hours_left < 0 — тик 09:00,
  // а дедлайн был сегодня утром) → заголовок «Дедлайн пропущен», не «скоро».
  const hoursLeft = job.payload.hours_left as number | undefined;
  const overdue =
    (job.payload.level as string) === 'overdue' || (hoursLeft ?? 0) < 0;
  const taskCard = buildTaskNotifyCard(
    card,
    overdue ? 'deadline_overdue' : 'deadline',
    { hoursLeft }
  );

  for (const telegramId of recipients) {
    const messageId = await sendTelegramMessage(
      telegramId,
      taskCard.text,
      taskCard.replyMarkup
    );
    // FILE-02: reply-маппинг message_id → task_id
    if (messageId) {
      await rememberBotTaskMessage({
        taskId: job.payload.task_id as string,
        workspaceId: job.workspace_id,
        chatId: telegramId,
        messageId,
      });
    }
  }
}

// ============================================================================
// task_done — DM creator, fallback owners/admins
// ============================================================================

async function processTaskDoneNotification(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const recipients = await resolveTaskRecipients(job, {
    preferReviewer: false,
    preferCreator: true,
    // 086: done_approved уходит и исполнителю (completed_by = assigned_to),
    // не только постановщику.
    alsoAssignee: job.payload.completed_by as string | undefined,
  });
  if (!recipients.length) {
    console.error(
      `[bot-notify] Job ${job.id}: no recipient telegram_id for task_done (created_by=${job.payload.created_by ?? 'none'})`
    );
    return;
  }

  // 086: reason из payload (паттерн 083) — иначе фолбэк agent_events.
  const reason =
    (job.payload.reason as string | undefined) ||
    (await fetchLastMoveReason(
      job.workspace_id,
      job.payload.task_id as string | undefined
    ));
  const context: NotifyContext =
    job.payload.via_review === true ? 'done_approved' : 'done';
  const hasDetails = job.payload.has_details === true;
  const card = await buildTaskCardData(job, {});
  const taskCard = buildTaskNotifyCard(card, context, { reason, hasDetails });

  for (const telegramId of recipients) {
    const messageId = await sendTelegramMessage(
      telegramId,
      taskCard.text,
      taskCard.replyMarkup
    );
    // FILE-02: reply-маппинг message_id → task_id
    if (messageId) {
      await rememberBotTaskMessage({
        taskId: job.payload.task_id as string,
        workspaceId: job.workspace_id,
        chatId: telegramId,
        messageId,
      });
    }
    // FILE-01: итоговые артефакты агента — после карточки
    await sendTaskAttachments(telegramId, job.payload.task_id as string | undefined);
  }
}

// ============================================================================
// task_started — DM creator («⚙️ ONI-42 взята агентом "X" в работу»),
// fallback owners/admins (если задачу создал агент или у постановщика нет TG)
// ============================================================================

async function processTaskStartedNotification(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const recipients = await resolveTaskRecipients(job, {
    preferReviewer: false,
    preferCreator: true,
  });
  if (!recipients.length) {
    console.error(
      `[bot-notify] Job ${job.id}: no recipient telegram_id for task_started (created_by=${job.payload.created_by ?? 'none'})`
    );
    return;
  }

  const agentName = await fetchAgentDisplayName(
    job.payload.claimed_by as string | undefined
  );
  const fullId = escapeHtml((job.payload.full_id as string) || '?');
  const html = `⚙️ Задача <b>${fullId}</b> взята агентом «${escapeHtml(agentName)}» в работу`;

  for (const telegramId of recipients) {
    await sendTelegramMessage(telegramId, html);
  }
}

async function fetchAgentDisplayName(
  workerId: string | undefined
): Promise<string> {
  if (!workerId) return 'агент';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: worker } = await supabase
    .from('workers')
    .select('display_name')
    .eq('id', workerId)
    .maybeSingle();
  return ((worker?.display_name as string) || '').trim() || 'агент';
}

// ============================================================================
// task_review — reviewer → creator → owner/admin + approve/fix buttons
// ============================================================================

async function processTaskReviewNotification(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const recipients = await resolveTaskRecipients(job, {
    preferReviewer: true,
    preferCreator: true,
  });
  if (!recipients.length) {
    console.error(
      `[bot-notify] Job ${job.id}: no recipient for task_review`
    );
    return;
  }

  const reason =
    (job.payload.reason as string | undefined) ||
    (await fetchLastMoveReason(
      job.workspace_id,
      job.payload.task_id as string | undefined
    ));
  const hasDetails = job.payload.has_details === true;
  const card = await buildTaskCardData(job, {});
  const taskId = job.payload.task_id as string | undefined;
  const taskCard = buildTaskNotifyCard(card, 'review', { reason, taskId, hasDetails });

  for (const telegramId of recipients) {
    const messageId = await sendTelegramMessage(
      telegramId,
      taskCard.text,
      taskCard.replyMarkup
    );
    // FILE-02: reply-маппинг message_id → task_id
    if (messageId) {
      await rememberBotTaskMessage({
        taskId: taskId ?? '',
        workspaceId: job.workspace_id,
        chatId: telegramId,
        messageId,
      });
    }
    // FILE-01: результат агента перед апрувом — после карточки
    await sendTaskAttachments(telegramId, taskId);
  }
}

// ============================================================================
// Broadcast cards (workspace chats)
// ============================================================================

async function buildBroadcastCard(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<{
  text: string;
  replyMarkup?: {
    inline_keyboard: Array<
      Array<{ text: string; url?: string; callback_data?: string }>
    >;
  };
}> {
  const alertType = (job.payload.alert_type as string) || 'unknown';
  const reason =
    (job.payload.escalation_reason as string) ||
    (job.payload.reason as string) ||
    '';
  const suggestedAction = job.payload.suggested_action as string | undefined;
  // Корень эскалации из ops_nack (migration: trigger_escalation_alert
  // прокидывает metadata.nack_reason/nack_detail в payload).
  const nackReason = job.payload.nack_reason as string | undefined;
  const nackDetail = job.payload.nack_detail as string | undefined;
  const card = await buildTaskCardData(job, {});

  switch (alertType) {
    case 'escalation_alert':
      return buildTaskNotifyCard(card, 'escalation', {
        reason,
        suggestedAction,
        nackReason,
        nackDetail,
      });
    case 'escalation_resolved':
      return buildTaskNotifyCard(card, 'escalation_resolved');
    case 'deadline_approaching':
      return buildTaskNotifyCard(card, 'deadline', {
        hoursLeft: job.payload.hours_left as number | undefined,
      });
    case 'resolution_notify':
      return buildTaskNotifyCard(card, 'unblocked');
    case 'cascade_unblock':
          return buildTaskNotifyCard(card, 'cascade');
    case 'handoff_chain_alert':
      return buildTaskNotifyCard(card, 'handoff');
    case 'duplicate':
      // DUP-01: алерт ставит process_duplicate_check (миграция 122) в
      // enrichment_queue типом 'bot_notify'. Поля приходят из его payload:
      // duplicate_of_full_id + similarity.
      return buildTaskNotifyCard(card, 'duplicate', {
        duplicateOfFullId: job.payload.duplicate_of_full_id as string | undefined,
        similarity: job.payload.similarity as number | undefined,
      });
    default:
      return {
        text: `<b>📢 Уведомление</b>\n\nНеизвестный тип: ${escapeHtml(alertType)}`,
      };
  }
}

async function sendEscalationFallbackDMs(job: {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const recipients = await resolveTaskRecipients(job, {
    preferReviewer: false,
    preferCreator: true,
  });
  if (!recipients.length) return;

  const cardMsg = await buildBroadcastCard(job);
  for (const telegramId of recipients) {
    await sendTelegramMessage(
      telegramId,
      cardMsg.text,
      cardMsg.replyMarkup
    );
  }
}


// ============================================================================
// Data loaders
// ============================================================================

async function resolveWorkerDisplayName(
  workerId: string | null | undefined
): Promise<string | null> {
  if (!workerId) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabase
    .from('workers')
    .select('display_name')
    .eq('id', workerId)
    .maybeSingle();
  return data?.display_name ?? null;
}

async function buildTaskCardData(
  job: { id: string; workspace_id: string; payload: Record<string, unknown> },
  opts: { assigneeNameFallback?: string | null }
): Promise<TaskCardData> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const taskId = job.payload.task_id as string | undefined;

  const { data: ws } = await supabase
    .from('workspaces')
    .select('name, slug, task_prefix')
    .eq('id', job.workspace_id)
    .maybeSingle();

  if (taskId) {
    const { data: task } = await supabase
      .from('tasks')
      .select(
        'id, title, description, column, priority, deadline, metadata, task_number, created_by, assigned_to, reviewer_id, is_blocked, is_inbox'
      )
      .eq('id', taskId)
      .maybeSingle();

    const meta = (task?.metadata as Record<string, unknown>) || {};
    const fullId =
      (job.payload.full_id as string) ||
      (task?.task_number != null
        ? `${ws?.task_prefix || '?'}-${task.task_number}`
        : '?');

    const title =
      (meta.rewritten_title as string) ||
      task?.title ||
      (job.payload.title as string) ||
      '';
    const description =
      (meta.rewritten_description as string) || task?.description || null;
    const clarityScore =
      typeof meta.clarity_score === 'number' ? meta.clarity_score : null;

    const assignedByName = await resolveWorkerDisplayName(
      task?.created_by as string | null
    );
    const assigneeName =
      opts.assigneeNameFallback ??
      (await resolveWorkerDisplayName(task?.assigned_to as string | null));
    const reviewerName = await resolveWorkerDisplayName(
      task?.reviewer_id as string | null
    );

    return {
      fullId,
      title,
      description,
      column: task?.column || (job.payload.column as string) || 'backlog',
      isInbox: Boolean(task?.is_inbox),
      isBlocked: Boolean(task?.is_blocked),
      priority:
        (task?.priority as TaskCardData['priority']) ||
        ((job.payload.priority as TaskCardData['priority']) ?? 'medium'),
      dueDate:
        (task?.deadline as string) ||
        (job.payload.deadline as string) ||
        null,
      assigneeName,
      assignedByName,
      reviewerName,
      workspaceHandle: ws?.name || ws?.slug || '',
      clarityScore,
    };
  }

  return {
    fullId: (job.payload.full_id as string) || '?',
    title: (job.payload.title as string) || '',
    description: (job.payload.description as string) || null,
    column: (job.payload.column as string) || 'backlog',
    isInbox: false,
    isBlocked: false,
    priority: (job.payload.priority as TaskCardData['priority']) || 'medium',
    dueDate: (job.payload.deadline as string) || null,
    assigneeName: opts.assigneeNameFallback ?? null,
    assignedByName: null,
    reviewerName: null,
    workspaceHandle: ws?.name || ws?.slug || '',
    clarityScore: null,
  };
}
async function fetchLastMoveReason(
  workspaceId: string,
  taskId: string | undefined
): Promise<string> {
  if (!taskId) return '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Doc 07 read path (0.9): prefer latest ops_terminal / terminal_execution
  // event (metadata.summary / reason written by ops_terminal RPC 062),
  // fall back to legacy move_task → metadata.reason.
  const { data: terminalEvents } = await supabase
    .from('agent_events')
    .select('metadata')
    .eq('workspace_id', workspaceId)
    .eq('task_id', taskId)
    .in('tool', ['ops_terminal', 'terminal_execution'])
    .order('created_at', { ascending: false })
    .limit(1);
  const terminalMeta = terminalEvents?.[0]?.metadata as
    | Record<string, unknown>
    | undefined;
  const terminalReason = String(
    terminalMeta?.summary || terminalMeta?.reason || ''
  ).trim();
  if (terminalReason) return terminalReason;

  const { data: events } = await supabase
    .from('agent_events')
    .select('metadata')
    .eq('workspace_id', workspaceId)
    .eq('task_id', taskId)
    .eq('tool', 'move_task')
    .order('created_at', { ascending: false })
    .limit(1);
  return (
    ((events?.[0]?.metadata as Record<string, unknown>)?.reason as string) ||
    ''
  );
}

/**
 * Recipient chain: reviewer (opt) → creator → owners/admins.
 */
async function resolveTaskRecipients(
  job: { workspace_id: string; payload: Record<string, unknown> },
  opts: {
    preferReviewer: boolean;
    preferCreator: boolean;
    /** 086: доп. получатель — исполнитель задачи (workers.id). */
    alsoAssignee?: string | undefined;
  }
): Promise<number[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const profileIds: string[] = [];

  const pushWorkerProfile = async (workerId: string | undefined) => {
    if (!workerId) return;
    const { data: worker } = await supabase
      .from('workers')
      .select('source_id, type')
      .eq('id', workerId)
      .maybeSingle();
    if (worker?.type === 'human' && worker.source_id) {
      profileIds.push(worker.source_id as string);
    } else if (workerId) {
      profileIds.push(workerId);
    }
  };

  if (opts.preferReviewer) {
    await pushWorkerProfile(job.payload.reviewer_id as string | undefined);
  }

  if (profileIds.length === 0 && opts.preferCreator) {
    let createdBy = job.payload.created_by as string | undefined;
    if (!createdBy && job.payload.task_id) {
      const { data: task } = await supabase
        .from('tasks')
        .select('created_by')
        .eq('id', job.payload.task_id as string)
        .maybeSingle();
      createdBy = task?.created_by as string | undefined;
    }
    await pushWorkerProfile(createdBy);
  }

  // 086: исполнитель — дополнительный получатель (не вместо, а вместе с creator).
  if (opts.alsoAssignee) {
    await pushWorkerProfile(opts.alsoAssignee);
  }

  if (profileIds.length === 0) {
    const { data: admins } = await supabase
      .from('workers')
      .select('source_id')
      .eq('workspace_id', job.workspace_id)
      .eq('type', 'human')
      .eq('is_active', true)
      .in('role', ['owner', 'admin']);
    for (const admin of admins ?? []) {
      if (admin.source_id) profileIds.push(admin.source_id as string);
    }
  }

  const telegramIds: number[] = [];
  for (const profileId of [...new Set(profileIds)]) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_id')
      .eq('id', profileId)
      .maybeSingle();
    if (profile?.telegram_id) {
      telegramIds.push(profile.telegram_id as number);
    }
  }
  return [...new Set(telegramIds)];
}

// ============================================================================
// Member added
// ============================================================================

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
  lines.push(
    `👋 <b>${escapeHtml(displayName)}</b>, тебя добавили в рабочее пространство onitask!`
  );
  lines.push('');
  lines.push(`Роль: ${roleLabels[role] ?? role}`);
  return lines.join('\n');
}

// ============================================================================
// Chats / status
// ============================================================================

async function getActiveChats(
  workspaceId: string
): Promise<Array<{ chat_id: number }>> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabase
    .from('workspace_telegram_chats')
    .select('chat_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  return (data ?? []) as any;
}

async function updateJobStatus(jobId: string, status: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const updateData: Record<string, unknown> = { status };
  if (status === 'done' || status === 'failed') {
    updateData.processed_at = new Date().toISOString();
  }
  await supabase.from('enrichment_queue').update(updateData).eq('id', jobId);
}

// ============================================================================
// Helpers
// ============================================================================


// ============================================================================
// Исходящие файлы агента (FILE-01/03)
// ============================================================================

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

const PHOTO_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function mimeForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

function sanitizeAttachmentFilename(filename: string): string {
  // Telegram требует имя без path-traversal; берём только basename.
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? 'file';
  return base.slice(-120);
}

/**
 * Отправить один файл в чат: фото (png/jpg/webp/gif) → sendPhoto,
 * остальное → sendDocument. Бросает при ошибке (для retry очереди).
 */
async function sendTelegramFile(
  chatId: number,
  attachment: Record<string, unknown>
): Promise<void> {
  const filename = sanitizeAttachmentFilename(
    String(attachment.filename ?? 'file')
  );
  const contentBase64 = String(attachment.content_base64 ?? '');
  if (!contentBase64) throw new Error('attachment missing content_base64');
  const bytes = decodeBase64(contentBase64);
  const mime = mimeForFilename(filename);
  const isPhoto = PHOTO_EXTENSIONS.test(filename);
  const method = isPhoto ? 'sendPhoto' : 'sendDocument';
  const field = isPhoto ? 'photo' : 'document';

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(field, new Blob([bytes], { type: mime }), filename);
  const caption = String(attachment.caption ?? '').trim();
  if (caption) form.append('caption', caption.slice(0, 1024));

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram ${method} failed (${resp.status}): ${body}`);
  }
}

/**
 * Прочитать attachments, сохранённые для задачи (ops_terminal → task_attachments),
 * скачать байты из Storage и отправить в чат ПОСЛЕ текстовой карточки.
 * Ошибка per-file не роняет остальные.
 */
async function sendTaskAttachments(
  chatId: number,
  taskId: string | undefined
): Promise<number> {
  if (!taskId) return 0;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows } = await supabase
    .from('task_attachments')
    .select('filename, mime_type, storage_path, size_bytes')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .limit(10);
  if (!rows || rows.length === 0) return 0;

  let sent = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    try {
      const storagePath = String(row.storage_path ?? '');
      if (!storagePath) continue;
      const { data: blob } = await supabase.storage
        .from('task-attachments')
        .download(storagePath);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const filename = sanitizeAttachmentFilename(String(row.filename ?? ''));
      const form = new FormData();
      form.append('chat_id', String(chatId));
      const isPhoto = PHOTO_EXTENSIONS.test(filename);
      form.append(
        isPhoto ? 'photo' : 'document',
        new Blob([bytes], {
          type: String(row.mime_type ?? mimeForFilename(filename)),
        }),
        filename
      );
      const method = isPhoto ? 'sendPhoto' : 'sendDocument';
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
      const resp = await fetch(url, { method: 'POST', body: form });
      if (resp.ok) sent++;
      else
        console.error(
          `[bot-notify] sendTaskAttachment ${filename} failed: ${resp.status} ${await resp.text()}`
        );
    } catch (err) {
      console.error('[bot-notify] sendTaskAttachment error:', err);
    }
  }
  return sent;
}

// ============================================================================
// telegram_message_queue consumer (MCP-15 / FILE-01)
// ============================================================================

/**
 * FILE-02: reply-маппинг message_id карточки → task_id (для «reply + файл → прикрепить»).
 * INSERT ... ON CONFLICT DO NOTHING (UNIQUE(chat_id, message_id)).
 */
async function rememberBotTaskMessage(opts: {
  taskId: string;
  workspaceId: string;
  chatId: number;
  messageId: number;
}): Promise<void> {
  if (!opts.taskId || !opts.messageId) return;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabase
      .from('bot_task_messages')
      .upsert(
        {
          workspace_id: opts.workspaceId,
          task_id: opts.taskId,
          chat_id: opts.chatId,
          message_id: opts.messageId,
        },
        { onConflict: 'chat_id,message_id', ignoreDuplicates: true }
      );
  } catch (err) {
    console.error('[bot-notify] rememberBotTaskMessage error:', err);
  }
}

/**
 * Читает pending/retrying строки исходящей очереди агента и шлёт их в Telegram.
 * Текст (sendMessage, с inline-кнопкой по metadata.full_id) → затем файлы
 * (attachments, base64 → multipart). Sent/failed проставляет по результату,
 * retry_count инкрементируется (policy max_retries=3 из 024).
 */
async function drainTelegramMessageQueue(): Promise<number> {
  if (!TELEGRAM_BOT_TOKEN) return 0;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('telegram_message_queue')
    .select(
      'id, telegram_chat_id, message, attachments, metadata, status, retry_count, max_retries'
    )
    .in('status', ['pending', 'retrying'])
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);

  if (error || !data) {
    if (error) console.error('[bot-notify] queue read error:', error);
    return 0;
  }

  let processed = 0;
  for (const row of data as Array<Record<string, unknown>>) {
    const chatId = Number(row.telegram_chat_id);
    try {
      const text = String(row.message ?? '').trim();
      const metadata = (row.metadata as Record<string, unknown>) ?? {};
      const attachments =
        (row.attachments as Array<Record<string, unknown>>) ?? [];

      if (text.length > 0) {
        let replyMarkup:
          | {
              inline_keyboard: Array<
                Array<{ text: string; url?: string; callback_data?: string }>
              >;
            }
          | undefined;
        if (metadata.full_id) {
          replyMarkup = {
            inline_keyboard: [
              [
                {
                  text: '💬 Обсудить задачу',
                  url: taskCommentsDeepLink(String(metadata.full_id)),
                },
              ],
            ],
          };
        }
        await sendTelegramMessage(chatId, text, replyMarkup, true);
      }
      for (const attachment of attachments) {
        await sendTelegramFile(chatId, attachment);
      }

      await supabase
        .from('telegram_message_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', row.id);
      processed++;
    } catch (err) {
      const retryCount = ((row.retry_count as number) ?? 0) + 1;
      const maxRetries = (row.max_retries as number) ?? 3;
      const failed = retryCount >= maxRetries;
      await supabase
        .from('telegram_message_queue')
        .update({
          status: failed ? 'failed' : 'retrying',
          retry_count: retryCount,
          failed_at: failed ? new Date().toISOString() : null,
          error_message: String(
            err instanceof Error ? err.message : err
          ).slice(0, 500),
        })
        .eq('id', row.id);
    }
  }
  return processed;
}

async function sendTelegramMessage(
  chatId: number,
  html: string,
  replyMarkup?: {
    inline_keyboard: Array<
      Array<{ text: string; url?: string; callback_data?: string }>
    >;
  },
  throwOnError = false
): Promise<number | null> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html.slice(0, 4096),
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(
      `[bot-notify] Telegram sendMessage failed (chat_id=${chatId}): ${resp.status} ${body}`
    );
    if (throwOnError) {
      throw new Error(`Telegram sendMessage ${resp.status} ${body}`);
    }
    return null;
  }
  const data = await resp.json();
  return data?.result?.message_id ?? null;
}
