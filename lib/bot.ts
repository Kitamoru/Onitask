// Telegram Bot API helpers
// Utilities for sending messages, inline keyboards, and webhook handling
// Supports Bot API 10.2+ (Rich Messages, Draft Streaming, Ephemeral)
import crypto from 'crypto';
import type {
  BotAPIResponse,
  InlineKeyboardMarkup,
  InlineKeyboardButton,
  RichMessageOptions,
  DraftParams,
  SendMessageParams,
  EditMessageTextParams,
  DeleteMessageParams,
  SendChatActionParams,
  AnswerCallbackQueryParams,
  Message,
} from '../types/telegram';

// ============================================================================
// Configuration
// ============================================================================
const BOT_API_URL = 'https://api.telegram.org/bot';
const MAX_MESSAGE_LENGTH = 4096; // Consistent with MCP contract
const DRAFT_TIMEOUT_MS = 20000; // 20 seconds safety margin

// Mini App config (§6.2d)
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? 'onitaskbot';
const MINI_APP_SHORT_NAME = 'onitask';

// ============================================================================
// HTML Sanitization (security_.md §4.1, bot_.md v0.5.0)
// ============================================================================

/**
 * Escape HTML special characters for safe insertion into Telegram messages.
 * Prevents interpretation of <, >, & as Telegram markup.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '\x26amp\x3B')
    .replace(/</g, '\x26lt\x3B')
    .replace(/>/g, '\x26gt\x3B');
}

/**
 * Sanitize output for Telegram rich messages.
 * Whitelist: <b>, <i>, <u>, <s>, <code>, <pre>, <tg-thinking>, <details>, <summary>
 */
export function sanitizeOutput(text: string, target: 'tg'): string {
  if (!text) return '';

  let sanitized = escapeHtml(text);

  const allowedTags = ['b', 'i', 'u', 's', 'code', 'pre', 'tg-thinking', 'details', 'summary'];

  for (const tag of allowedTags) {
    // reserved for future whitelist un-escaping
  }

  sanitized = sanitized.replace(/href=/gi, '');
  sanitized = sanitized.replace(/onclick=/gi, '');
  sanitized = sanitized.replace(/onerror=/gi, '');
  sanitized = sanitized.replace(/onload=/gi, '');

  return sanitized;
}

// ============================================================================
// Core Bot API Client
// ============================================================================

/**
 * Make a request to the Telegram Bot API.
 */
async function botApiRequest<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const url = `${BOT_API_URL}${token}/${method}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data: BotAPIResponse<T> = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram Bot API error: ${data.description} (code: ${data.error_code})`);
  }

  return data.result as T;
}

// ============================================================================
// HMAC Webhook Verification (SEC-03)
// ============================================================================

/**
 * Verify Telegram webhook secret token.
 * Telegram sends TELEGRAM_BOT_SECRET directly in X-Telegram-Bot-Api-Secret-Token header.
 * No HMAC computation needed — direct timingSafeEqual comparison.
 */
export function verifyTelegramWebhookSecret(
  providedSecret: string,
  storedSecret: string
): boolean {
  if (!providedSecret || !storedSecret) return false;

  try {
    return timingSafeEqual(
      Buffer.from(providedSecret, 'utf8'),
      Buffer.from(storedSecret, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Timing-safe buffer comparison to prevent timing attacks.
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============================================================================
// Basic Messaging
// ============================================================================

/**
 * Send a message via Telegram Bot API.
 */
export async function sendMessage(
  token: string,
  params: SendMessageParams
): Promise<Message> {
  return botApiRequest<Message>(token, 'sendMessage', {
    chat_id: params.chat_id,
    text: params.text.slice(0, MAX_MESSAGE_LENGTH),
    parse_mode: params.parse_mode,
    reply_markup: params.reply_markup,
    disable_notification: params.disable_notification,
    protect_content: params.protect_content,
    message_thread_id: params.message_thread_id,
  });
}

/**
 * Edit a previously sent message text.
 */
export async function editMessageText(
  token: string,
  params: EditMessageTextParams
): Promise<Message | boolean> {
  return botApiRequest<Message | boolean>(token, 'editMessageText', {
    chat_id: params.chat_id,
    message_id: params.message_id,
    inline_message_id: params.inline_message_id,
    text: params.text.slice(0, MAX_MESSAGE_LENGTH),
    parse_mode: params.parse_mode,
    reply_markup: params.reply_markup,
  });
}

/**
 * Delete a message.
 */
export async function deleteMessage(
  token: string,
  params: DeleteMessageParams
): Promise<boolean> {
  return botApiRequest<boolean>(token, 'deleteMessage', {
    chat_id: params.chat_id,
    message_id: params.message_id,
  });
}

/**
 * Send a chat action (typing indicator, etc.).
 */
export async function sendChatAction(
  token: string,
  params: SendChatActionParams
): Promise<boolean> {
  return botApiRequest<boolean>(token, 'sendChatAction', {
    chat_id: params.chat_id,
    action: params.action,
    message_thread_id: params.message_thread_id,
  });
}

// ============================================================================
// Message Reactions (Bot API 8.0+)
// ============================================================================

/**
 * Set a reaction on a message (emoji).
 * Fire-and-forget — used for 👀 (receiving) and ✅ (success).
 */
export async function setMessageReaction(
  token: string,
  chatId: number | string,
  messageId: number,
  emoji: string
): Promise<void> {
  await botApiRequest<void>(token, 'setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: emoji,
  });
}

// ============================================================================
// Voice File Helpers
// ============================================================================

/**
 * Get the downloadable URL for a voice file.
 * Uses Telegram getFile(file_id) API instead of constructing URL from file_id.
 * Returns null if file_id is missing or API call fails.
 */
export async function getVoiceFileUrl(
  token: string,
  fileId: string
): Promise<string | null> {
  if (!fileId) return null;
  try {
    const data = await botApiRequest<{ file_path: string }>(token, 'getFile', {
      file_id: fileId,
    });
    return `https://api.telegram.org/file/bot${token}/${data.file_path}`;
  } catch {
    return null;
  }
}

// ============================================================================
// Callback Query Handling
// ============================================================================

/**
 * Answer a callback query (from inline keyboard buttons).
 */
export async function answerCallbackQuery(
  token: string,
  params: AnswerCallbackQueryParams
): Promise<boolean> {
  return botApiRequest<boolean>(token, 'answerCallbackQuery', {
    callback_query_id: params.callback_query_id,
    text: params.text,
    show_alert: params.show_alert,
    url: params.url,
    cache_time: params.cache_time,
  });
}

// ============================================================================
// Rich Messages (Bot API 10.1+)
// ============================================================================

/**
 * Send a rich message with HTML content.
 * Supports up to 32,768 characters (but we cap at 4096 for consistency).
 * Uses parse_mode: 'HTML' so <b>, <i>, <code> etc. are rendered.
 */
export async function sendRichMessage(
  token: string,
  options: RichMessageOptions
): Promise<Message> {
  const params: Record<string, unknown> = {
    chat_id: options.chat_id,
  };

  if (options.rich_message?.html) {
    params.text = options.rich_message.html.slice(0, MAX_MESSAGE_LENGTH);
    params.parse_mode = 'HTML';
  } else if (options.text) {
    params.text = options.text.slice(0, MAX_MESSAGE_LENGTH);
  }

  if (options.reply_markup) params.reply_markup = options.reply_markup;
  if (options.disable_notification) params.disable_notification = true;
  if (options.protect_content) params.protect_content = true;
  if (options.allow_sending_without_reply) params.allow_sending_without_reply = true;

  if (options.receiver_user_id) {
    params.receiver_user_id = options.receiver_user_id;
  }
  if (options.callback_query_id) {
    params.callback_query_id = options.callback_query_id;
  }

  return botApiRequest<Message>(token, 'sendMessage', params);
}

/**
 * Send a rich message draft for streaming updates.
 * The draft is visible as a preview and must be finalized with sendRichMessage.
 */
export async function sendRichMessageDraft(
  token: string,
  params: DraftParams
): Promise<void> {
  const draftParams: Record<string, unknown> = {
    chat_id: params.chat_id,
    draft_id: params.draft_id,
    is_final: params.is_final ?? false,
  };

  if (params.text) {
    draftParams.text = params.text.slice(0, MAX_MESSAGE_LENGTH);
  }
  if (params.rich_message?.html) {
    draftParams.text = params.rich_message.html.slice(0, MAX_MESSAGE_LENGTH);
    draftParams.parse_mode = 'HTML';
  }
  if (params.reply_to_message_id) {
    draftParams.reply_to_message_id = params.reply_to_message_id;
  }

  return botApiRequest<void>(token, 'sendMessageDraft', draftParams);
}

// ============================================================================
// Ephemeral Messages (Bot API 10.2+)
// ============================================================================

/**
 * Send an ephemeral message (visible only to receiver_user_id).
 * Uses receiver_user_id parameter on sendMessage.
 */
export async function sendEphemeralMessage(
  token: string,
  chatId: number | string,
  text: string,
  receiverUserId: number,
  extra?: { reply_markup?: InlineKeyboardMarkup }
): Promise<Message> {
  return botApiRequest<Message>(token, 'sendMessage', {
    chat_id: chatId,
    text: text.slice(0, MAX_MESSAGE_LENGTH),
    receiver_user_id: receiverUserId,
    ...extra,
  });
}

/**
 * Send an ephemeral rich message.
 */
export async function sendEphemeralRichMessage(
  token: string,
  chatId: number | string,
  html: string,
  receiverUserId: number,
  extra?: { reply_markup?: InlineKeyboardMarkup }
): Promise<Message> {
  return botApiRequest<Message>(token, 'sendMessage', {
    chat_id: chatId,
    text: html.slice(0, MAX_MESSAGE_LENGTH),
    parse_mode: 'HTML',
    receiver_user_id: receiverUserId,
    ...extra,
  });
}

/**
 * Delete an ephemeral message.
 */
export async function deleteEphemeralMessage(
  token: string,
  chatId: number | string,
  ephemeralMessageId: number
): Promise<boolean> {
  return botApiRequest<boolean>(token, 'deleteEphemeralMessage', {
    chat_id: chatId,
    ephemeral_message_id: ephemeralMessageId,
  });
}

// ============================================================================
// Mini App Deep Links (§6.2d)
// ============================================================================

/**
 * Build a Direct Link Mini App deep link.
 * Opens Mini App (not browser) in any chat including groups.
 * Format: https://t.me/<bot>/<app>?startapp=<param>
 * start_param must use only [A-Za-z0-9_-], max 512 chars.
 */
export function miniAppDeepLink(startParam?: string): string {
  const base = `https://t.me/${BOT_USERNAME}/${MINI_APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

/**
 * Build task URL for Mini App.
 * Prefixes full_id with "task_" for start_param routing.
 */
export function taskUrl(fullId: string): string {
  return miniAppDeepLink(`task_${fullId}`);
}

// ============================================================================
// Inline Keyboard Builders
// ============================================================================

/**
 * Build an inline keyboard with a single row of buttons.
 */
export function buildInlineKeyboard(
  buttons: Array<{ text: string; callback_data?: string; url?: string }>
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [buttons],
  };
}

/**
 * Build a multi-row inline keyboard.
 */
export function buildMultiRowInlineKeyboard(
  rows: Array<Array<{ text: string; callback_data?: string; url?: string }>>
): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((btn) => {
        const button: InlineKeyboardButton = { text: btn.text };
        if (btn.callback_data) button.callback_data = btn.callback_data;
        if (btn.url) button.url = btn.url;
        return button as InlineKeyboardButton;
      })
    ),
  };
}

// ============================================================================
// Unified Task Card Builder (§6.2d)
// ============================================================================

/**
 * Task card data from RPC get_task_card_data / webhook construction.
 */
export type TaskCardData = {
  fullId: string;
  title: string;
  description?: string | null;
  column: string;
  isInbox: boolean;
  isBlocked: boolean;
  priority: 'high' | 'medium' | 'low' | null;
  dueDate: string | null;
  assigneeName: string | null;
  workspaceHandle: string;
  clarityScore: number | null;
};

/** AI clarity_score is 0..1 */
const LOW_CLARITY_THRESHOLD = 0.55;

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
};

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(dueDate));
}

function truncateForTelegram(str: string, limit: number): string {
  return str.length > limit ? str.slice(0, limit) + '…' : str;
}

function isLowClarity(card: TaskCardData): boolean {
  return card.clarityScore != null && card.clarityScore < LOW_CLARITY_THRESHOLD;
}

/**
 * Render the body of a task card (shared across all contexts).
 *
 * Format:
 * 📋 <b>Title</b>
 * <blockquote>full description</blockquote>
 *
 * 📍 Status · board
 * 👤 Assignee
 * 🟡 Priority · deadline
 */
export function renderTaskCardBody(card: TaskCardData): string {
  const status = card.isInbox ? 'Inbox' : STATUS_LABELS[card.column] ?? card.column;
  const title = escapeHtml(truncateForTelegram(card.title, 120));
  const description = card.description?.trim()
    ? escapeHtml(card.description.trim()) // full description, no truncation
    : null;

  const lines: string[] = [];

  // 📋 Title
  lines.push(`📋 <b>${title}</b>`);

  // Description in blockquote (Telegram frame)
  if (description) {
    lines.push(`<blockquote>${description}</blockquote>`);
  }

  lines.push(''); // blank line

  // 📍 Status · board
  lines.push(`📍 ${status} · ${escapeHtml(card.workspaceHandle)}`);

  // 👤 Assignee
  const assignee = card.assigneeName ? escapeHtml(card.assigneeName) : 'Не назначено';
  lines.push(`👤 ${assignee}`);

  // Priority · deadline (one line)
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

  return lines.join('\n');
}

/**
 * Build a unified task card message with inline keyboard.
 * Three contexts: 'created', 'duplicate', 'lookup'.
 * Low-clarity tasks show "✏️ Уточнить", others show "Открыть в приложении".
 */
export function buildTaskCard(
  card: TaskCardData,
  context: 'created' | 'duplicate' | 'lookup'
): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
} {
  const fullId = escapeHtml(card.fullId);

  let header: string | null = null;
  if (context === 'created') {
    header = `✅ Задача <b>${fullId}</b> создана`;
  } else if (context === 'duplicate') {
    header = `✅ Уже зафиксирована · <b>${fullId}</b>`;
  }
  // lookup — no header

  const body = renderTaskCardBody(card);
  const text = header ? `${header}\n\n${body}` : body;

  const primaryButton = isLowClarity(card)
    ? { text: `✏️ Уточнить ${card.fullId} →`, url: taskUrl(card.fullId) }
    : { text: 'Открыть в приложении', url: taskUrl(card.fullId) };

  return {
    text: text.slice(0, MAX_MESSAGE_LENGTH),
    replyMarkup: { inline_keyboard: [[primaryButton]] },
  };
}

/**
 * Legacy buildTaskCardHTML — kept for backward compatibility.
 * Prefer buildTaskCard() for new code.
 */
export function buildTaskCardHTML(task: {
  full_id: string;
  title: string;
  description?: string;
  column?: string;
  priority?: string;
  assignee_name?: string;
  deadline?: string;
}): string {
  const { full_id, title, description, column, priority, assignee_name, deadline } = task;

  let html = `<b>🔖 ${escapeHtml(full_id)} · «${escapeHtml(title)}»</b>\n\n`;

  if (description) {
    html += `<blockquote>${escapeHtml(description)}</blockquote>\n\n`;
  }

  html += `<details>`;
  html += `<summary>📋 Атрибуты</summary>\n`;

  if (column) html += `📍 Статус: ${escapeHtml(column)}\n`;
  if (priority) html += `🔴 Приоритет: ${escapeHtml(priority)}\n`;
  if (assignee_name) html += `👤 Назначен: ${escapeHtml(assignee_name)}\n`;
  if (deadline) html += `📅 Дедлайн: ${escapeHtml(deadline)}\n`;

  html += `</details>`;

  return html;
}

/**
 * Build confirmation inline keyboard for task actions.
 */
export function buildTaskConfirmationKeyboard(taskFullId: string): InlineKeyboardMarkup {
  return buildInlineKeyboard([
    { text: '📋 Открыть в TWA →', url: `/board?task=${taskFullId}` },
  ]);
}

/**
 * Build flow board HTML summary.
 */
export function buildFlowBoardHTML(metrics: {
  todo: number;
  inProgress: number;
  done: number;
  overloaded?: string[];
  blocked?: number;
}): string {
  let html = `<b>📊 Flow Board</b>\n\n`;
  html += `<pre>To Do: ${metrics.todo}
In Progress: ${metrics.inProgress}
Done: ${metrics.done}</pre>\n`;

  if (metrics.blocked && metrics.blocked > 0) {
    html += `\n⚠️ Заблокировано: ${metrics.blocked}\n`;
  }

  if (metrics.overloaded && metrics.overloaded.length > 0) {
    html += `\n⚠️ Перегружены: ${metrics.overloaded.map(escapeHtml).join(', ')}\n`;
  }

  return html;
}

/**
 * Build inbox tasks HTML list.
 */
export function buildInboxHTML(
  tasks: Array<{
    full_id: string;
    title: string;
    priority?: string;
  }>
): string {
  if (!tasks.length) return '📥 Inbox пуст.';

  let html = `<b>📥 Inbox</b>\n\n`;

  for (const task of tasks.slice(0, 10)) {
    const emoji =
      task.priority === 'critical' ? '🔴' : task.priority === 'high' ? '🟡' : '🟢';
    html += `${emoji} <b>${escapeHtml(task.full_id)}</b>: ${escapeHtml(task.title)}\n`;
  }

  if (tasks.length > 10) {
    html += `\n...ещё ${tasks.length - 10} задач`;
  }

  return html;
}

/**
 * Build standup digest HTML.
 */
export function buildStandupHTML(data: {
  date: string;
  movedTasks?: Array<{ title: string; from: string; to: string; assignee: string }>;
  stuckTasks?: Array<{ title: string; daysStuck: number; assignee: string }>;
  overloadedWorkers?: Array<{ name: string; budget: string }>;
  inboxTasks?: Array<{ title: string; hoursOld: number; lowClarity: boolean }>;
}): string {
  let html = `<b>📋 Стендап · ${escapeHtml(data.date)}</b>\n\n`;

  if (data.movedTasks?.length) {
    html += `<b>✅ Вчера двигалось:</b>\n`;
    for (const t of data.movedTasks.slice(0, 5)) {
      html += `· «${escapeHtml(t.title)}» → ${escapeHtml(t.to)} (${escapeHtml(t.assignee)})\n`;
    }
    if (data.movedTasks.length > 5) {
      html += `...ещё ${data.movedTasks.length - 5} задач\n`;
    }
    html += '\n';
  } else {
    html += `Вчера активности не было\n\n`;
  }

  if (data.stuckTasks?.length) {
    html += `<b>⏳ Зависло (>72ч без движения):</b>\n`;
    for (const t of data.stuckTasks) {
      html += `· «${escapeHtml(t.title)}» — ${t.daysStuck} дня в работе (${escapeHtml(t.assignee)})\n`;
    }
    html += '\n';
  }

  if (data.overloadedWorkers?.length) {
    html += `<b>⚠️ Перегружены:</b>\n`;
    for (const w of data.overloadedWorkers) {
      html += `· ${escapeHtml(w.name)} — когнитивный бюджет ${w.budget}\n`;
    }
    html += '\n';
  }

  if (data.inboxTasks?.length) {
    html += `<b>📥 В inbox без подтверждения (>24ч):</b>\n`;
    for (const t of data.inboxTasks.slice(0, 3)) {
      const action = t.lowClarity ? '[уточнить →]' : '[открыть →]';
      html += `· «${escapeHtml(t.title)}» — создана ${t.hoursOld}ч назад ${action}\n`;
    }
    html += '\n';
  }

  return html;
}

/**
 * Build freemium gate message.
 */
export function buildFreemiumGateHTML(feature: string): string {
  return `<tg-callout>Создание задач через бот доступно с плана Solo (290₽/мес). Перейти: [ссылка на TWA настройки]</tg-callout>`;
}

/**
 * Build welcome message for onboarding (v0.6.5 spec).
 */
export function buildWelcomeHTML(workspaceSlug: string): string {
  return `
<b>👋 Добро пожаловать в @${escapeHtml(workspaceSlug)}!</b>
Ты добавлен как участник.
<details>
<summary>📖 Что можно делать</summary>
• /create-task [текст] — создать задачу
• /create-task 🎤 — создать задачу голосом
• /run-task TASK-123 — посмотреть задачу
</details>
`.trim();
}

/**
 * Build resolve confirmation message.
 */
export function buildResolveHTML(fullId: string): string {
  return `✅ Эскалация ${escapeHtml(fullId)} снята.\nАгент возобновит работу в течение минуты.\n[Открыть задачу →]`;
}

// ============================================================================
// Workspace Selection Keyboard Builder
// ============================================================================

/**
 * Build inline keyboard for workspace selection.
 * Supports three modes:
 * 1. Command mode: callback_data = "select_ws:<wsId>:<command>"
 * 2. Draft mode: callback_data = "select_ws:<wsId>:draft"
 * 3. No extra data: callback_data = "select_ws:<wsId>"
 *
 * draftId is intentionally not embedded in callback_data (64-byte limit).
 */
export function buildWorkspaceSelectionKeyboard(
  workspaces: Array<{ id: string; slug: string; title?: string }>,
  options?: { command?: string; draftId?: string }
): InlineKeyboardMarkup {
  let suffix: string;
  if (options?.draftId) {
    suffix = 'draft';
  } else if (options?.command) {
    suffix = options.command;
  } else {
    suffix = '';
  }

  const buttons = workspaces.slice(0, 8).map((ws) => ({
    text: ws.title || ws.slug,
    callback_data: suffix ? `select_ws:${ws.id}:${suffix}` : `select_ws:${ws.id}`,
  }));

  const rows: Array<Array<{ text: string; callback_data?: string }>> = buttons.map(
    (btn) => [btn]
  );

  return {
    inline_keyboard: rows.map((row) =>
      row.map((btn) => {
        const button: InlineKeyboardButton = { text: btn.text };
        if (btn.callback_data) button.callback_data = btn.callback_data;
        return button as InlineKeyboardButton;
      })
    ),
  };
}

/**
 * Parse callback_data from workspace selection button.
 * Returns { workspaceId, type, extra } where:
 * - type: 'command' | 'draft' | null
 * - extra: command name or draftId
 */
export function parseWorkspaceCallbackData(callbackData: string): {
  workspaceId: string;
  type: 'command' | 'draft' | null;
  extra: string;
} {
  const parts = callbackData.split(':');

  if (parts[0] !== 'select_ws' || parts.length < 2) {
    return { workspaceId: '', type: null, extra: '' };
  }

  const workspaceId = parts[1];

  if (parts.length === 2) {
    return { workspaceId, type: null, extra: '' };
  }

  const secondPart = parts[2];

  if (secondPart === 'draft' && parts.length >= 3) {
    const draftId = parts.slice(3).join(':');
    return { workspaceId, type: 'draft', extra: draftId };
  }

  return { workspaceId, type: 'command', extra: secondPart };
}

/**
 * Build welcome HTML after workspace selection.
 */
export function buildWorkspaceSelectedHTML(workspaceTitle: string): string {
  return `✅ Выбрано рабочее пространство: <b>${escapeHtml(workspaceTitle)}</b>\n\nТеперь вы можете использовать команды бота в этом workspace.`;
}
