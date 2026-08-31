// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
// supabase/functions/bot-notify/index.ts — Bot Notify Worker (BOT-10)
// Unified task-card UI (assignment template) on top of production v0.7.x
//
// Auth: vault secret via RPC get_bot_notify_cron_secret (timing-safe, INV-06)
// Cards: full_id in headers, blockquote body, inline open button always
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_USERNAME = Deno.env.get('TELEGRAM_BOT_USERNAME') ?? 'onitaskbot';
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
    return new Response(JSON.stringify({ processed: jobs.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
    const html = buildMemberAddedHTML(job.payload);
    await sendTelegramMessage(profile.telegram_id, html, {
      inline_keyboard: [
        [{ text: 'Открыть доску', url: miniAppDeepLink() }],
      ],
    });
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
  });
  if (!recipients.length) {
    console.error(
      `[bot-notify] Job ${job.id}: no recipient telegram_id for task_done (created_by=${job.payload.created_by ?? 'none'})`
    );
    return;
  }

  const reason = await fetchLastMoveReason(
    job.workspace_id,
    job.payload.task_id as string | undefined
  );
  const card = await buildTaskCardData(job, {});
  const taskCard = buildTaskNotifyCard(card, 'done', { reason });

  for (const telegramId of recipients) {
    await sendTelegramMessage(telegramId, taskCard.text, taskCard.replyMarkup);
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
  const card = await buildTaskCardData(job, {});
  const taskId = job.payload.task_id as string | undefined;
  const taskCard = buildTaskNotifyCard(card, 'review', { reason, taskId });

  for (const telegramId of recipients) {
    await sendTelegramMessage(telegramId, taskCard.text, taskCard.replyMarkup);
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
  const card = await buildTaskCardData(job, {});

  switch (alertType) {
    case 'escalation_alert':
      return buildTaskNotifyCard(card, 'escalation', { reason, suggestedAction });
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
// Unified task card (assignment template as base)
// ============================================================================

type TaskCardData = {
  fullId: string;
  title: string;
  description?: string | null;
  column: string;
  isInbox: boolean;
  isBlocked: boolean;
  priority: 'high' | 'medium' | 'low' | 'critical' | null;
  dueDate: string | null;
  assigneeName: string | null;
  assignedByName: string | null;
  workspaceHandle: string;
  clarityScore: number | null;
};

type NotifyContext =
  | 'assigned'
  | 'done'
  | 'review'
  | 'escalation'
  | 'escalation_resolved'
  | 'deadline'
  | 'unblocked'
  | 'cascade'
  | 'handoff';

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
  backlog: 'Бэклог',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: '🔴 Высокий приоритет',
  medium: '🟡 Средний приоритет',
  low: '🟢 Низкий приоритет',
  critical: '🔴 Критический приоритет',
};

const LOW_CLARITY_THRESHOLD = 0.55;

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
    }).format(new Date(dueDate));
  } catch {
    return dueDate;
  }
}

function truncateForTelegram(str: string, limit: number): string {
  return str.length > limit ? str.slice(0, limit) + '…' : str;
}

function isLowClarity(card: TaskCardData): boolean {
  return card.clarityScore != null && card.clarityScore < LOW_CLARITY_THRESHOLD;
}

/** display_name → @username (Telegram auto-links) */
function formatPersonMention(name: string | null): string {
  if (!name) return '—';
  const clean = name.replace(/^@/, '').trim();
  if (!clean) return '—';
  return `@${escapeHtml(clean)}`;
}

function renderTaskCardBody(
  card: TaskCardData,
  options?: { extraLines?: string[] }
): string {
  const extraLines = options?.extraLines ?? [];
  const status = card.isInbox
    ? 'Inbox'
    : STATUS_LABELS[card.column] ?? card.column;
  const title = escapeHtml(
    truncateForTelegram(card.title || 'Без названия', 120)
  );
  const description = card.description?.trim()
    ? escapeHtml(card.description.trim())
    : null;

  const lines: string[] = [];
  lines.push(`📋 <b>${title}</b>`);
  if (description) {
    lines.push(`<blockquote>${description}</blockquote>`);
  }
  lines.push('');
  lines.push(`📍 ${status} · ${escapeHtml(card.workspaceHandle || '—')}`);
  lines.push(`👤 Исполнитель: ${formatPersonMention(card.assigneeName)}`);
  lines.push(`✍️ Постановщик: ${formatPersonMention(card.assignedByName)}`);

  const priority = card.priority ? PRIORITY_LABELS[card.priority] : null;
  const due = formatDueDate(card.dueDate);
  if (priority && due) {
    lines.push(`${priority} · ${due}`);
  } else if (priority) {
    lines.push(priority);
  } else if (due) {
    lines.push(`📅 ${due}`);
  }

  if (card.isBlocked) {
    lines.push('⛔ Заблокировано');
  }
  if (isLowClarity(card)) {
    lines.push('⚠️ Формулировка неточная — уточни в приложении');
  }

  for (const extra of extraLines) {
    if (extra) lines.push(extra);
  }

  return lines.join('\n');
}

function buildHeader(context: NotifyContext, fullId: string): string {
  const id = escapeHtml(fullId);
  switch (context) {
    case 'assigned':
      return `📝 Задача <b>${id}</b> назначена на тебя`;
    case 'done':
      return `✅ Задача <b>${id}</b> выполнена`;
    case 'review':
      return `🔎 Задача <b>${id}</b> ждет вашей проверки`;
    case 'escalation':
      return `🆘 Эскалация · <b>${id}</b>`;
    case 'escalation_resolved':
      return `✅ Эскалация <b>${id}</b> снята`;
    case 'deadline':
      return `📅 Дедлайн скоро · <b>${id}</b>`;
    case 'unblocked':
      return `🔓 Задача <b>${id}</b> разблокирована`;
    case 'cascade':
      return `🔗 Цепочка разблокирована · <b>${id}</b>`;
    case 'handoff':
      return `🤝 Задача <b>${id}</b> передана`;
    default:
      return `📋 Задача <b>${id}</b>`;
  }
}

function buildOpenButton(card: TaskCardData): { text: string; url: string } {
  if (isLowClarity(card)) {
    return {
      text: `✏️ Уточнить ${card.fullId} →`,
      url: taskDeepLink(card.fullId),
    };
  }
  return {
    text: 'Открыть в приложении',
    url: taskDeepLink(card.fullId),
  };
}

/**
 * Unified card. Always full_id in header; always open button.
 * Review adds approve/fix callback rows (task UUID only in callback_data).
 */
function buildTaskNotifyCard(
  card: TaskCardData,
  context: NotifyContext,
  extras?: {
    reason?: string;
    hoursLeft?: number;
    taskId?: string;
    suggestedAction?: string;
  }
): {
  text: string;
  replyMarkup: {
    inline_keyboard: Array<
      Array<{ text: string; url?: string; callback_data?: string }>
    >;
  };
} {
  const extraLines: string[] = [];

  if (context === 'escalation' && extras?.reason) {
    extraLines.push('');
    extraLines.push(`Причина: ${escapeHtml(extras.reason)}`);
    if (extras.suggestedAction) {
      extraLines.push(`Предлагаю: ${escapeHtml(extras.suggestedAction)}`);
    }
  } else if (extras?.reason) {
    extraLines.push('');
    extraLines.push(`Что сделано: ${escapeHtml(extras.reason)}`);
  }

  if (context === 'deadline' && extras?.hoursLeft != null) {
    extraLines.push('');
    extraLines.push(`Осталось ~${extras.hoursLeft}ч`);
  }
  if (context === 'escalation_resolved') {
    extraLines.push('');
    extraLines.push('Агент может продолжить работу.');
  }
  if (context === 'review') {
    extraLines.push('');
    extraLines.push('Подтвердите результат или верните на доработку.');
  }

  const header = buildHeader(context, card.fullId);
  const body = renderTaskCardBody(card, { extraLines });
  const text = `${header}\n\n${body}`.slice(0, 4096);

  const openBtn = buildOpenButton(card);
  let rows: Array<
    Array<{ text: string; url?: string; callback_data?: string }>
  >;

  if (context === 'review' && extras?.taskId) {
    rows = [
      [
        {
          text: 'Согласовать',
          callback_data: `ra:approve:${extras.taskId}`,
        },
      ],
      [
        {
          text: '🔧 Вернуть на доработку',
          callback_data: `ra:fix:${extras.taskId}`,
        },
      ],
      [openBtn],
    ];
  } else {
    rows = [[openBtn]];
  }

  return {
    text,
    replyMarkup: { inline_keyboard: rows },
  };
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
        'id, title, description, column, priority, deadline, metadata, task_number, created_by, assigned_to, is_blocked, is_inbox'
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
  opts: { preferReviewer: boolean; preferCreator: boolean }
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

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function miniAppDeepLink(startParam?: string): string {
  const base = `https://t.me/${BOT_USERNAME}/${MINI_APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

function taskDeepLink(fullId: string): string {
  return miniAppDeepLink(`task_${fullId}`);
}

async function sendTelegramMessage(
  chatId: number,
  html: string,
  replyMarkup?: {
    inline_keyboard: Array<
      Array<{ text: string; url?: string; callback_data?: string }>
    >;
  }
): Promise<void> {
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
  }
}
