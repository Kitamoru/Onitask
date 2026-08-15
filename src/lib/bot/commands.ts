// src/lib/bot/commands.ts — Команды бота (BOT-05, BOT-06, BOT-08, BOT-09)
// /inbox, /flow, /task ALPHA-123, /resolve, /standup, /stuck, /review
// bot_.md §5.3, §5.5–5.8

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
import type { Message } from '../../../types/telegram';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_MESSAGE_LENGTH = 4096;

// ============================================================================
// Command Router
// ============================================================================

/**
 * Route a command message to the appropriate handler.
 */
export async function handleCommand(
  msg: Message,
  command: string,
  args: string,
  workspaceId: string
): Promise<void> {
  const chatId = msg.chat.id;

  switch (command) {
    case 'inbox':
      await handleInbox(chatId, workspaceId);
      break;
    case 'flow':
      await handleFlow(chatId, workspaceId);
      break;
    case 'task':
      if (args) await handleTaskLookup(chatId, args);
      else await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: 'Использование: /task ALPHA-123' },
      });
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
      await handleReview(chatId, workspaceId);
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
  // Get tasks where assigned_to = current worker AND column = 'backlog' OR is_inbox = true
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('full_id, title, priority')
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

  const html = buildInboxHTML(
    (tasks ?? []).map((t: any) => ({
      full_id: t.full_id || '',
      title: t.title || '',
      priority: t.priority || '',
    }))
  );

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /flow — Flow Board статус
// ============================================================================

async function handleFlow(chatId: number, workspaceId: string): Promise<void> {
  // Get metrics from flow/metrics endpoint or direct SQL
  const { data: columns, error: colErr } = await supabase
    .from('tracker_columns')
    .select('column_name, task_count')
    .eq('workspace_id', workspaceId);

  let todo = 0, inProgress = 0, done = 0;
  if (!colErr && columns) {
    for (const col of columns) {
      if (col.column_name === 'backlog') todo += col.task_count || 0;
      if (col.column_name === 'in_progress') inProgress += col.task_count || 0;
      if (col.column_name === 'done') done += col.task_count || 0;
    }
  }

  const html = buildFlowBoardHTML({ todo, inProgress, done });

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /task ALPHA-123 — Lookup задачи по номеру
// ============================================================================

async function handleTaskLookup(chatId: number, fullId: string): Promise<void> {
  // Use find_task_by_full_id RPC
  const { data: task, error } = await supabase.rpc('find_task_by_full_id', { p_full_id: fullId });

  if (error || !task) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: `Задача ${escapeHtml(fullId)} не найдена.` },
    });
    return;
  }

  const html = buildTaskCardHTML({
    full_id: task.full_id || fullId,
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
  // 1. Find task
  const { data: task } = await supabase.rpc('find_task_by_full_id', { p_full_id: fullId });
  if (!task) {
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
    .eq('id', task.id);

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
    workspace_id: task.workspace_id,
    task_id: task.id,
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
    .select('task_id, from_column, to_column, created_at, workers(display_name)')
    .eq('workspace_id', workspaceId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  // Get stuck tasks (>72h without movement)
  const { data: stuckTasks } = await supabase
    .from('tasks')
    .select('id, title, column, updated_at, workers(display_name)')
    .eq('workspace_id', workspaceId)
    .eq('is_blocked', false)
    .neq('column', 'done')
    .lte('updated_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    .limit(5);

  // Get overloaded workers
  const { data: overloadedWorkers } = await supabase
    .from('workers')
    .select('id, display_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

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
    movedTasks: (movedTasks ?? []).map((t: any) => ({
      title: (t as any).task_title || '',
      from: t.from_column || '',
      to: t.to_column || '',
      assignee: (t as any).workers?.display_name || '',
    })),
    stuckTasks: (stuckTasks ?? []).map((t: any) => ({
      title: t.title || '',
      daysStuck: Math.floor((Date.now() - new Date(t.updated_at).getTime()) / (24 * 60 * 60 * 1000)),
      assignee: (t as any).workers?.display_name || '',
    })),
    overloadedWorkers: [], // TODO: compute from cognitive budget
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
// /stuck — Задачи с флагом is_blocked
// ============================================================================

async function handleStuck(chatId: number, workspaceId: string): Promise<void> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('full_id, title, is_blocked, created_at')
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

  let html = '<b>🔒 Заблокированные задачи</b>\n\n';
  for (const t of tasks) {
    html += `• <b>${escapeHtml(t.full_id || '')}</b>: ${escapeHtml(t.title || '')}\n`;
  }

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}

// ============================================================================
// /review — Задачи в колонке review для текущего пользователя
// ============================================================================

async function handleReview(chatId: number, workspaceId: string): Promise<void> {
  // TODO: Need worker_id from telegram_user_id to filter by reviewer_id
  const { data: tasks } = await supabase
    .from('tasks')
    .select('full_id, title, column')
    .eq('workspace_id', workspaceId)
    .eq('column', 'review')
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
    html += `• <b>${escapeHtml(t.full_id || '')}</b>: ${escapeHtml(t.title || '')}\n`;
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

// ============================================================================
// /help — Список команд
// ============================================================================

async function handleHelp(chatId: number): Promise<void> {
  const html = `
<b>📖 Доступные команды:</b>

/task [текст] — создать задачу
/task ALPHA-123 — показать задачу
@onitask [текст] — inline создание задачи

/inbox — показать задачи в inbox
/flow — статус Flow Board
/standup — утренний дайджест команды

/stuck — заблокированные задачи
/review — задачи на проверке
/resolve ALPHA-123 — снять эскалацию

/summary — AI Flow Summary (AI Dev/Team)
/help — этот список
`.trim();

  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: html.slice(0, MAX_MESSAGE_LENGTH) },
  });
}