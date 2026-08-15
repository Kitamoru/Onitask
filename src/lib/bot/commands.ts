// src/lib/bot/commands.ts — Команды бота (BOT-05, BOT-06, BOT-08, BOT-09)
// /inbox, /flow, /task, /resolve, /standup, /stuck, /review
// bot_.md §5.3, §5.5–5.8
//
// FIX: handleInbox — не выбирает full_id как столбец (это RPC функция).
// handleFlow — показывает только фактическое количество задач (без WIP limits).
// handleReview — фильтрует по reviewer_id текущего пользователя.
// /task объединена: текст → handleTextTask, голос → handleVoiceTask.

import { createClient } from '@supabase/supabase-js';
import {
  sendRichMessage,
  buildFlowBoardHTML,
  buildInboxHTML,
  buildTaskCardHTML,
  buildResolveHTML,
  buildStandupHTML,
  escapeHtml,
} from '../../../lib/bot';
import { handleTextTask, handleVoiceTask } from './taskHandler';
import { setPendingTask } from './taskDraft';
import type { Message } from '../../../types/telegram';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Mapping of DB column names to Russian display names.
 * Source: onitask_flow_.md §2
 */
const COLUMN_LABELS: Record<string, string> = {
  backlog: 'В очереди',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Сделано',
};

/**
 * Check if workspaceId is empty (lazy selection mode).
 */
function hasNoWorkspace(workspaceId: string): boolean {
  return !workspaceId || workspaceId === '';
}

/**
 * Resolve profile UUID from Telegram user ID.
 */
async function resolveProfileId(telegramUserId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Route a command message to the appropriate handler.
 * If workspaceId is empty, only /help is available.
 */
export async function handleCommand(
  msg: Message,
  command: string,
  args: string,
  workspaceId: string
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;

  // If no workspace selected, only /help works
  if (hasNoWorkspace(workspaceId)) {
    if (command === 'help') {
      await handleHelp(chatId);
    } else {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: '⚠️ Для выполнения этой команды выберите рабочее пространство. Введите команду снова, и бот предложит выбрать доску.' },
      });
    }
    return;
  }

  switch (command) {
    case 'inbox':
      await handleInbox(chatId, workspaceId);
      break;
    case 'flow':
      await handleFlow(chatId, workspaceId);
      break;
    case 'task':
      // Unified /task flow via drafts (bot_task_drafts):
      // - If there are args (ALPHA-123) → lookup task by ID
      // - If there is a voice message → create task from voice
      // - If there is text (but not full_id) → create task from text
      // - If no args, no voice → enter pending mode: ask user to send text/voice
      if (args) {
        // Check if args looks like a task ID (ALPHA-123 pattern)
        if (/^[A-Z]+-\d+$/.test(args)) {
          await handleTaskLookup(chatId, args);
        } else {
          // Treat as task creation text
          await handleTextTask(msg, args, workspaceId);
        }
      } else if (msg.voice) {
        // Voice message → create task from voice
        await handleVoiceTask(msg, workspaceId);
      } else {
        // No args, no voice → enter pending mode
        // User will receive next message as task description
        await setPendingTask(chatId);
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: { html: '📝 Для создания задачи пришлите текст или голосовое сообщение.\nБот сохранит черновик и покажет подтверждение.' },
        });
      }
      break;
    case 'resolve':
      if (args) await handleResolve(chatId, args);
      else await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: 'Использование: /resolve ALPHA-123' },
      });
      break;
    case 'standup':
      await handleStandup(chatId, workspaceId);
      break;
    case 'stuck':
      await handleStuck(chatId, workspaceId);
      break;
    case 'review':
      await handleReview(chatId, workspaceId, userId);
      break;
    case 'summary':
      await handleSummary(chatId, workspaceId);
      break;
    case 'help':
      await handleHelp(chatId);
      break;
    default:
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: `⚠️ Неизвестная команда: /${command}. Введите /help для списка команд.` },
      });
  }
}

// ============================================================================
// /inbox — Показать Inbox пользователя
// ============================================================================

async function handleInbox(chatId: number, workspaceId: string): Promise<void> {
  // Get tasks where is_inbox = true
  // FIX: Don't select 'full_id' as it's not a column — use task_full_id() RPC or just title
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, priority, created_at')
    .eq('workspace_id', workspaceId)
    .eq('is_inbox', true)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Ошибка при получении inbox.' },
    });
    return;
  }

  // Build full_id for each task using task_full_id() RPC
  const taskList = (tasks ?? []).map((t: any) => ({
    full_id: `${t.title}`, // placeholder — full_id requires RPC call per task
    title: t.title || '',
    priority: t.priority || '',
  }));

  const html = buildInboxHTML(taskList);

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /flow — Flow Board статус (только фактическое количество, без WIP limits)
// ============================================================================

async function handleFlow(chatId: number, workspaceId: string): Promise<void> {
  // Get column counts from tasks table
  const { data: columnCounts, error } = await supabase
    .from('tasks')
    .select('column')
    .eq('workspace_id', workspaceId)
    .eq('is_inbox', false);

  if (error) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Ошибка при получении статуса доски.' },
    });
    return;
  }

  // Count tasks per column
  const columnMap: Record<string, number> = { backlog: 0, in_progress: 0, review: 0, done: 0 };
  ((columnCounts ?? []) as any[]).forEach((t) => {
    if (t.column in columnMap) {
      columnMap[t.column]++;
    }
  });

  // Build HTML with Russian column names (no WIP limits)
  let html = '<b>📊 Flow Board</b>\n\n';

  for (const [colKey, count] of Object.entries(columnMap)) {
    const label = COLUMN_LABELS[colKey] || colKey;
    html += `<b>${escapeHtml(label)}</b>: ${count}\n`;
  }

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /task ALPHA-123 — Lookup задачи по номеру
// ============================================================================

async function handleTaskLookup(chatId: number, fullId: string): Promise<void> {
  // Use find_task_by_full_id RPC to get task UUID
  const { data: taskId, error } = await supabase.rpc('find_task_by_full_id', { p_full_id: fullId });

  if (error || !taskId) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `Задача ${escapeHtml(fullId)} не найдена.` },
    });
    return;
  }

  // Fetch full task details
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();

  if (taskErr || !task) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `Не удалось загрузить задачу ${escapeHtml(fullId)}.` },
    });
    return;
  }

  const html = buildTaskCardHTML({
    full_id: fullId,
    title: task.title || '',
    description: task.description as string | undefined,
    column: task.column as string | undefined,
    priority: task.priority as string | undefined,
    assignee_name: (task as any).assignee_name as string | undefined,
    deadline: task.deadline ? new Date(task.deadline).toLocaleDateString() : undefined,
  });

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /resolve ALPHA-123 — Снять эскалацию
// ============================================================================

async function handleResolve(chatId: number, fullId: string): Promise<void> {
  // 1. Find task via RPC
  const { data: taskId, error: rpcError } = await supabase.rpc('find_task_by_full_id', { p_full_id: fullId });

  if (rpcError || !taskId) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `Задача ${escapeHtml(fullId)} не найдена.` },
    });
    return;
  }

  // 2. Update needs_human = false
  const { error } = await supabase
    .from('tasks')
    .update({ needs_human: false })
    .eq('id', taskId);

  if (error) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Ошибка при снятии эскалации.' },
    });
    return;
  }

  // 3. INSERT into enrichment_queue (bot_notify)
  await supabase.from('enrichment_queue').insert({
    type: 'bot_notify',
    status: 'pending',
    workspace_id: '' as any, // resolved below
    payload: {
      alert_type: 'escalation_resolved',
      full_id: fullId,
    },
  });

  // 4. Confirm
  const html = buildResolveHTML(fullId);
  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /standup — Daily Standup дайджест
// ============================================================================

async function handleStandup(chatId: number, workspaceId: string): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'numeric' });

  // Get moved tasks (task_column_history last 24h)
  const { data: movedTasks } = await supabase
    .from('task_column_history')
    .select('task_id, from_column, to_column, moved_at')
    .eq('workspace_id', workspaceId)
    .gte('moved_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('moved_at', { ascending: false })
    .limit(20);

  // Get stuck tasks (>72h without movement)
  const { data: stuckTasks } = await supabase
    .from('tasks')
    .select('id, title, column, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('is_blocked', false)
    .neq('column', 'done')
    .lte('updated_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    .limit(5);

  // Get inbox tasks >24h
  const { data: inboxTasks } = await supabase
    .from('tasks')
    .select('id, title, created_at, tags')
    .eq('workspace_id', workspaceId)
    .eq('is_inbox', true)
    .lte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(3);

  const html = buildStandupHTML({
    date: dateStr,
    movedTasks: [],
    stuckTasks: (stuckTasks ?? []).map((t: any) => ({
      title: t.title || '',
      daysStuck: Math.floor((Date.now() - new Date(t.updated_at).getTime()) / (24 * 60 * 60 * 1000)),
      assignee: '',
    })),
    overloadedWorkers: [],
    inboxTasks: (inboxTasks ?? []).map((t: any) => ({
      title: t.title || '',
      hoursOld: Math.floor((Date.now() - new Date(t.created_at).getTime()) / (60 * 60 * 1000)),
      lowClarity: (t.tags as string[])?.includes('low-clarity') ?? false,
    })),
  });

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /stuck — Задачи с флагом is_blocked + inline выбор для разблокировки
// ============================================================================

async function handleStuck(chatId: number, workspaceId: string): Promise<void> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, full_id, title, is_blocked, column, assignee_name')
    .eq('workspace_id', workspaceId)
    .eq('is_blocked', true)
    .order('created_at', { ascending: true })
    .limit(10);

  if (!tasks?.length) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '🟢 Заблокированных задач нет.' },
    });
    return;
  }

  // Build inline keyboard with task buttons
  const keyboard = {
    inline_keyboard: [
      tasks.map((t: any) => ({
        text: `${escapeHtml(t.full_id || '')} — ${escapeHtml(t.title || '')}`,
        callback_data: `unblock_task:${t.id}`,
      })),
    ],
  };

  let html = '<b>🔒 Заблокированные задачи</b>\n\nНажмите на задачу для разблокировки:\n\n';
  for (const t of tasks) {
    html += `• <b>${escapeHtml(t.full_id || '')}</b>: ${escapeHtml(t.title || '')}\n`;
  }

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
    reply_markup: keyboard as any,
  });
}

// ============================================================================
// /review — Задачи в колонке review для текущего пользователя
// ============================================================================

async function handleReview(chatId: number, workspaceId: string, telegramUserId: number): Promise<void> {
  // FIX: Resolve profile → worker, then filter by reviewer_id
  const profileId = await resolveProfileId(telegramUserId);
  if (!profileId) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Профиль не найден.' },
    });
    return;
  }

  // Find worker record for this user in this workspace
  const { data: worker } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  if (!worker) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Вы не являетесь участником этого workspace.' },
    });
    return;
  }

  // Filter tasks by reviewer_id = current worker
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, column')
    .eq('workspace_id', workspaceId)
    .eq('column', 'review')
    .eq('reviewer_id', worker.id)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (!tasks?.length) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '🟢 Задач на проверке нет.' },
    });
    return;
  }

  let html = '<b>🔍 Задачи на проверке</b>\n\n';
  for (const t of tasks) {
    html += `• <b>${escapeHtml(t.title || '')}</b>\n`;
  }

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /summary — AI Flow Summary (F-03 Cold Path, AI Dev/Team only)
// ============================================================================

async function handleSummary(chatId: number, workspaceId: string): Promise<void> {
  // TODO: Check plan_type — только AI Dev/Team
  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: '⏳ Формирую AI Flow Summary...' },
  });

  // TODO: Call F-03 Cold Path Edge Function
}

/**
 * Handle unblock task from inline keyboard (/stuck flow).
 */
export async function handleUnblockTask(taskId: string, chatId: number, workspaceId: string): Promise<void> {
  // Get task details
  const { data: task, error } = await supabase
    .from('tasks')
    .select('full_id, title, is_blocked')
    .eq('id', taskId)
    .maybeSingle();

  if (error || !task) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Задача не найдена.' },
    });
    return;
  }

  // Unset is_blocked
  const { error: updateErr } = await supabase
    .from('tasks')
    .update({ is_blocked: false })
    .eq('id', taskId);

  if (updateErr) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Ошибка при разблокировке задачи.' },
    });
    return;
  }

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: `✅ Задача ${escapeHtml(task.full_id || taskId)} разблокирована.` },
  });
}

// ============================================================================
// /help — Список команд
// ============================================================================

async function handleHelp(chatId: number): Promise<void> {
  const html = `
<b>📖 Доступные команды:</b>

/task [текст] — создать задачу
/task ALPHA-123 — показать задачу
/task 🎤 — создать задачу голосом
@onitask [текст] — inline создание задачи

/inbox — показать задачи в inbox
/flow — статус Flow Board
/standup — утренний дайджест команды

/stuck — заблокированные задачи
/review — задачи на проверке
/resolve ALPHA-123 — снять эскалацию

/summary — AI Flow Summary (AI Dev/Team)
/help — этот список

<b>💡 Совет:</b> При первом использовании команды бот предложит выбрать доску. Далее выбор запоминается.
`.trim();

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}
