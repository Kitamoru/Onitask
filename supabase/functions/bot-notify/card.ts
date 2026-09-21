// card.ts — pure card builders for bot-notify (no Deno APIs).
// Extracted from index.ts so vitest can unit-test them in node-env.
// Deep-link base is injectable via CARD_CONFIG (index.ts syncs it from
// TELEGRAM_BOT_USERNAME env at startup).

export const CARD_CONFIG = {
  botUsername: 'onitaskbot',
  miniAppShortName: 'onitask',
};

// ============================================================================
// Unified task card (assignment template as base)
// ============================================================================

export type TaskCardData = {
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
  /** Проверяющий (display_name). Optional — omit to hide line; null → «—» (как у Постановщика). */
  reviewerName?: string | null;
  workspaceHandle: string;
  clarityScore: number | null;
};

export type NotifyContext =
  | 'assigned'
  | 'done'
  | 'done_approved'
  | 'review'
  | 'escalation'
  | 'escalation_resolved'
  | 'deadline'
  | 'deadline_overdue'
  | 'unblocked'
  | 'cascade'
  | 'handoff';

export const STATUS_LABELS: Record<string, string> = {
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
  backlog: 'Бэклог',
};

export const PRIORITY_LABELS: Record<string, string> = {
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

export function renderTaskCardBody(
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
  // 🔍 Reviewer — only when field is present (undefined = hide, null = show "—")
  if (card.reviewerName !== undefined) {
    lines.push(`🔍 Проверяющий: ${formatPersonMention(card.reviewerName)}`);
  }

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

export function buildHeader(context: NotifyContext, fullId: string): string {
  const id = escapeHtml(fullId);
  switch (context) {
    case 'assigned':
      return `📝 Задача <b>${id}</b> назначена на тебя`;
    case 'done':
      return `✅ Задача <b>${id}</b> выполнена`;
    case 'done_approved':
      return `✅ Результат задачи <b>${id}</b> согласован`;
    case 'review':
      return `🔎 Задача <b>${id}</b> ждет вашей проверки`;
    case 'escalation':
      return `🆘 Эскалация · <b>${id}</b>`;
    case 'escalation_resolved':
      return `✅ Эскалация <b>${id}</b> снята`;
    case 'deadline':
      return `📅 Дедлайн скоро · <b>${id}</b>`;
    case 'deadline_overdue':
      return `🔴 Дедлайн пропущен · <b>${id}</b>`;
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

export function buildOpenButton(card: TaskCardData): { text: string; url: string } {
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
export function buildTaskNotifyCard(
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
    extraLines.push(`Результат: ${escapeHtml(extras.reason)}`);
  }

  if (
    (context === 'deadline' || context === 'deadline_overdue') &&
    extras?.hoursLeft != null
  ) {
    const h = extras.hoursLeft;
    extraLines.push('');
    extraLines.push(
      h >= 0 ? `Осталось ~${h}ч` : `Просрочено на ~${Math.abs(h)}ч`
    );
  }
  if (context === 'escalation_resolved') {
    extraLines.push('');
    extraLines.push('Агент может продолжить работу.');
  }
  if (context === 'review') {
    extraLines.push('');
    extraLines.push('Подтвердите результат или верните на доработку.');
  }
  if (context === 'done_approved') {
    extraLines.push('');
    extraLines.push('Задача перенесена в Сделано.');
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

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function miniAppDeepLink(startParam?: string): string {
  const base = `https://t.me/${CARD_CONFIG.botUsername}/${CARD_CONFIG.miniAppShortName}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

export function taskDeepLink(fullId: string): string {
  return miniAppDeepLink(`task_${fullId}`);
}

/** FILE-01/03: deep-link сразу на вкладку «Комментарии» задачи */
export function taskCommentsDeepLink(fullId: string): string {
  return miniAppDeepLink(`task_${fullId}_comments`);
}
