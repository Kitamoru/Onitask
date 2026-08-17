// POST /api/bot/webhook — Telegram Bot Webhook Endpoint
// Handles incoming updates from Telegram Bot API
// SEC-03: Secret token verification via timingSafeEqual
// BOT-05: Lazy workspace selection — no initial board prompt
// SERVERLESS-SAFE: No in-memory state — uses DB for drafts, callback_data for commands
// v0.6.5 spec: /create-task, /run-task, /help only
//
// Commands:
//   /create-task [text] → save draft → select workspace → execute F-04 pipeline
//   /create-task 🎤 (voice) → transcribe → save draft → select workspace → F-04
//   /run-task TASK-123 → lookup task by full_id
//   /help → list available commands
//
// Workflow:
//   1. /create-task [text]: INSERT into bot_task_drafts → callback_data = "select_ws:<wsId>:draft"
//      → consume draft + create task in same callback
//   2. /run-task TASK-123: callback_data = "select_ws:<wsId>:run:TASK-123" → lookup in same callback

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyTelegramWebhookSecret,
  sendMessage,
  sendChatAction,
  answerCallbackQuery,
  editMessageText,
  buildWorkspaceSelectionKeyboard,
  parseWorkspaceCallbackData,
  escapeHtml,
  buildTaskCard,
  setMessageReaction,
  TaskCardData,
} from '../../../../../lib/bot';
import { handleStartCommand } from '../../../../../src/lib/bot/onboarding';
import { handleCommand } from '../../../../../src/lib/bot/commands';
import { resolveWorkspace, getUserAvailableWorkspaces, resolveProfileId } from '../../../../../src/lib/bot/workspaceResolver';
import { checkFreemiumBoundary } from '../../../../../src/lib/bot/freemium';
import { setPendingTask, clearPendingTask, isPendingTaskMode } from '../../../../../src/lib/bot/taskDraft';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_BOT_SECRET;

/**
 * Parse command from message text. Returns [command, args] or null.
 */
function parseCommand(text: string): [string, string] | null {
  const trimmed = text.trim();
  // Handle /command or /command@botname args
  const match = trimmed.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/);
  if (!match) return null;
  return [match[1], match[2] || ''];
}

/**
 * Commands that require workspace selection before execution.
 * v0.6.5 spec: only /create-task needs workspace (for draft execution).
 */
const COMMANDS_REQUIRING_WORKSPACE = ['create-task'];

/**
 * Commands that work WITHOUT workspace (start, help).
 */
const WORKSPACE_FREE_COMMANDS = ['start', 'help'];

/**
 * Dispatch update to appropriate handler based on update type.
 */
async function dispatchUpdate(update: any): Promise<void> {
  // === LOG: incoming update ===
  const cb = update.callback_query;
  const msg = update.message || update.edited_message;
  if (cb) {
    console.log('[Bot Webhook] UPDATE type=callback_query id=' + cb.id + ' data=' + (cb.data ?? 'null') + ' from_user=' + (cb.from?.id ?? '?'));
  } else if (msg) {
    console.log('[Bot Webhook] UPDATE type=message chat=' + msg.chat?.id + ' type=' + msg.chat?.type + ' text=' + (msg.text ?? '[voice]') + ' from=' + (msg.from?.id ?? '?'));
  } else {
    console.log('[Bot Webhook] UPDATE type=unknown (no callback_query, no message)');
  }

  // Handle callback_query (inline button presses)
  const callbackQuery = update.callback_query;
  if (callbackQuery) {
    await handleCallbackQuery(callbackQuery);
    return;
  }

  // Handle message updates
  const message = update.message || update.edited_message;
  if (!message) {
    console.log('[Bot Webhook] Ignoring non-message update');
    return;
  }

  const chat = message.chat;
  const chatId = chat.id;
  const text = message.text;
  const userId = message.from?.id;

  if (!userId) {
    console.error('[Bot Webhook] ERROR No user id in message:', JSON.stringify(message).slice(0, 500));
    return;
  }

  // Ignore group messages
  if (chat.type !== 'private') {
    console.log('[Bot Webhook] Ignoring non-private chat: type=' + chat.type);
    return;
  }

  // Send typing indicator
  if (BOT_TOKEN) {
    await sendChatAction(BOT_TOKEN, { chat_id: chatId, action: 'typing' }).catch(() => {});
  }

  // Step 1: Check if it's a command
  let parsedCommand: [string, string] | null = null;
  if (text && text.startsWith('/')) {
    parsedCommand = parseCommand(text);
  }

  // Step 2: Resolve workspace — with detailed logging for debugging
  let workspaceResult: { workspace_id: string } | null;
  console.log('[Bot Webhook] >>> About to call resolveWorkspace, userId=' + userId + ', chatId=' + chatId);
  try {
    console.log('[Bot Webhook] >>> resolveWorkspace START');
    workspaceResult = await resolveWorkspace(userId, chatId, 'private');
    console.log('[Bot Webhook] >>> resolveWorkspace DONE, result=' + (workspaceResult ? 'found' : 'null') + ', userId=' + userId);
  } catch (err: any) {
    console.error('[Bot Webhook] >>> resolveWorkspace THREW ERROR:', err?.message || String(err));
    console.error('[Bot Webhook] >>> resolveWorkspace STACK:', err?.stack || 'no stack');
    workspaceResult = null;
  }

  // If workspace resolved, proceed with command handling
  if (workspaceResult && parsedCommand) {
    const [command, args] = parsedCommand;
    const workspaceId = workspaceResult.workspace_id;

    // Freemium check for restricted commands
    const gateMessage = await checkFreemiumBoundary(command, userId, workspaceId);
    if (gateMessage) {
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: gateMessage,
      });
      return;
    }

    if (command === 'start') {
      try {
        await handleStartCommand(message, args);
      } catch (err) {
        console.error('[Bot Webhook] ERROR handleStartCommand:', err);
        await sendMessage(BOT_TOKEN!, { chat_id: chatId, text: '⚠️ Ошибка при обработке /start.' });
      }
      return;
    }

    // Route other commands
    try {
      await handleCommand(message, command, args, workspaceId);
    } catch (err) {
      console.error('[Bot Webhook] ERROR handleCommand (' + command + '):', err);
      await sendMessage(BOT_TOKEN!, { chat_id: chatId, text: '⚠️ Ошибка при выполнении команды.' });
    }
    return;
  }

  // Step 3: No workspace resolved — check if it's a command
  if (parsedCommand) {
    const [command, args] = parsedCommand;

    // Commands that work without workspace (start, help)
    if (WORKSPACE_FREE_COMMANDS.includes(command)) {
      await handleCommand(message, command, args, '');
      return;
    }

    // Commands that need workspace — show inline keyboard
    if (COMMANDS_REQUIRING_WORKSPACE.includes(command)) {
      await handleCommandRequiringWorkspace(chatId, userId, command, args);
      return;
    }

    // /run-task doesn't need workspace — handle directly
    if (command === 'run-task') {
      const fullId = args.trim();
      if (/^[A-Z]+-\d+$/.test(fullId)) {
        await handleResolveTask(BOT_TOKEN!, chatId, userId, message.message_id, fullId);
      } else {
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: '📝 Введите полный ID задачи, например: /run-task ALPHA-123',
        });
      }
      return;
    }

    // Unknown command — show help
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '⚠️ Неизвестная команда. Введите /help для списка команд.',
    });
    return;
  }

  // Step 4: Regular message — check if user is in "pending task" mode
  // If so, treat this text/voice as the task description → save draft → show board selection
  const pendingActive = await isPendingTaskMode(chatId);
  console.log('[Bot Webhook] Step 4: pendingActive=', pendingActive, 'chatId=', chatId, 'textLen=', text?.length, 'hasVoice=', !!message?.voice);

  if (pendingActive) {
    // Resolve profile UUID for DB operations
    const profileId = await resolveProfileId(userId);
    console.log('[Bot Webhook] Step 4: profileId=', profileId);
    if (!profileId) {
      await clearPendingTask(chatId);
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '⚠️ Профиль не найден. Начните с /start.',
      });
      return;
    }

    // User sent text after /task — create a real draft and show board selection
    let taskText = '';
    let source: string = 'nl';

    if (text && text.trim().length > 0) {
      taskText = text.trim();
      source = 'nl';
    } else if (message.voice) {
      // Voice message — check caption first (Telegram allows adding text to voice)
      if (message.caption && message.caption.trim().length > 0) {
        taskText = message.caption.trim();
        source = 'voice_with_caption';
      } else {
        // No caption — try to download and transcribe via STT API
        const voiceFileId = message.voice.file_id;
      const telegramFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/file_${voiceFileId}`;
      try {
        const resp = await fetch(telegramFileUrl, {
          headers: { 'Authorization': `Bot ${BOT_TOKEN}` },
        });
        if (resp.ok) {
          const blob = await resp.blob();
          // Upload blob to our STT endpoint (relative path — same Next.js app)
          const formData = new FormData();
          formData.append('file', blob, 'voice.ogg');
          const sttResp = await fetch('/api/ai/transcribe', {
            method: 'POST',
            body: formData,
          });
            if (sttResp.ok) {
              const sttData = await sttResp.json();
              taskText = sttData.text || `[Голосовое сообщение]`;
              source = 'voice';
            } else {
              // STT failed — use placeholder
              console.warn('[Bot Webhook] STT failed, using placeholder');
              taskText = '[Голосовое сообщение — текст недоступен]';
              source = 'voice';
            }
          }
        } catch (err) {
          console.error('[Bot Webhook] Failed to download/transcribe voice:', err);
          taskText = '[Голосовое сообщение — текст недоступен]';
          source = 'voice';
        }
      }
    }

    if (taskText.length > 0) {
      console.log('[Bot Webhook] Step 4: Creating draft, taskText=', taskText.slice(0, 100), 'source=', source);
      // ALWAYS clear pending first — even on error we don't want to loop
      await clearPendingTask(chatId);

      // Create real draft
      const { data: draftResult, error: draftError } = await supabase.rpc('create_bot_task_draft', {
        p_user_id: profileId,
        p_chat_id: chatId,
        p_title: taskText.slice(0, 500),
        p_description: null,
        p_source: source,
      });

      if (draftError || !draftResult) {
        console.error('[Bot Webhook] Failed to create draft from pending:', draftError);
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: '⚠️ Не удалось сохранить черновик. Отправьте задачу заново через /task.',
        });
        return;
      }

      console.log('[Bot Webhook] Draft created successfully, draftId=', draftResult);

      // Show workspace selection keyboard with draft
      const availableWorkspaces = await getUserAvailableWorkspaces(userId);
      console.log('[Bot Webhook] Step 4: availableWorkspaces count=', availableWorkspaces.length);
      if (availableWorkspaces.length === 0) {
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: 'У вас нет доступных рабочих пространств.',
        });
        return;
      }

      if (availableWorkspaces.length === 1) {
        // Single workspace — create task immediately
        await executeDraftInWorkspaceByChat(BOT_TOKEN!, chatId, userId, availableWorkspaces[0].id);
        return;
      }

      // Multiple workspaces — show selection
      const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, { draftId: draftResult });
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '✅ Черновик сохранён! Выберите доску:',
        reply_markup: keyboard,
      });
      return;
    }

    // Not text or voice — just send help
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '📝 Пожалуйста, отправьте текст или голосовое сообщение для создания задачи.',
    });
    return;
  }

  // No pending — regular help message
  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: '📝 Отправьте /help для списка команд или используйте бота через TWA.',
  });
}

/**
 * Handle commands that require workspace selection.
 * Uses serverless-safe approach:
 *   - /task [text]: save draft to DB, pass draftId in callback_data
 *   - /task (no args): prompt user to send text/voice → saved as draft
 *   - /task ALPHA-123: pass full_id in callback_data for lookup
 *
 * INV: profileId resolved once, reused for all DB calls.
 */
async function handleCommandRequiringWorkspace(
  chatId: number,
  userId: number,
  command: string,
  args: string
): Promise<void> {
  // Resolve profile UUID — canonical path for all DB operations
  const profileId = await resolveProfileId(userId);
  if (!profileId) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '⚠️ Профиль не найден. Начните с /start.',
    });
    return;
  }

  const availableWorkspaces = await getUserAvailableWorkspaces(userId);

  if (availableWorkspaces.length === 0) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: 'У вас нет доступных рабочих пространств. Введите код через администратора.',
    });
    return;
  }

  // Single workspace: auto-select, but still ask for text first for /create-task
  if (availableWorkspaces.length === 1) {
    const ws = availableWorkspaces[0];

    // /create-task without args → prompt for text, then save draft + auto-select board
    if (command === 'create-task' && (!args || args.trim().length === 0)) {
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\nБот сохранит черновик и покажет подтверждение.',
      });
      // Store pending context — detected in dispatchUpdate Step 4
      await setPendingTask(chatId, profileId);
      return;
    }

    // /create-task with text → save draft and create immediately (single workspace)
    if (command === 'create-task' && args && args.trim().length > 0) {
      const trimmedArgs = args.trim();

      // /create-task [text] — save draft and create immediately (single workspace)
      const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
        p_user_id: profileId,
        p_chat_id: chatId,
        p_title: trimmedArgs.slice(0, 500),
        p_description: null,
        p_source: 'nl',
      });

      if (error || !draftResult) {
        console.error('[Bot Webhook] Failed to create draft:', error);
        await sendMessage(BOT_TOKEN!, {
          chat_id: chatId,
          text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
        });
        return;
      }

      // Consume draft and create task in same workspace
      await executeDraftInWorkspaceByChat(BOT_TOKEN!, chatId, userId, ws.id);
      return;
    }

    return;
  }

  // /create-task without args → prompt for text first, board selection happens after draft is saved
  if (command === 'create-task' && (!args || args.trim().length === 0)) {
    await sendMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '📝 Для создания задачи пришлите текст или голосовое сообщение.\n\nБот сохранит черновик и покажет подтверждение.',
    });
    await setPendingTask(chatId, profileId);
    return;
  }

  // Multiple workspaces — show selection keyboard
  let keyboardOptions: { command?: string; draftId?: string } = {};

  if (command === 'create-task' && args && args.trim().length > 0) {
    // /create-task [text] — save draft to DB first
    const trimmedArgs = args.trim();

    // /create-task [text] — always save to DB as draft (no lookup mode)
    const { data: draftResult, error } = await supabase.rpc('create_bot_task_draft', {
      p_user_id: profileId,
      p_chat_id: chatId,
      p_title: trimmedArgs.slice(0, 500),
      p_description: null,
      p_source: 'nl',
    });

    if (error || !draftResult) {
      console.error('[Bot Webhook] Failed to create draft:', error);
      await sendMessage(BOT_TOKEN!, {
        chat_id: chatId,
        text: '⚠️ Не удалось сохранить черновик. Попробуйте ещё раз.',
      });
      return;
    }

    keyboardOptions.draftId = draftResult;
  }

  const keyboard = buildWorkspaceSelectionKeyboard(availableWorkspaces, keyboardOptions);

  await sendMessage(BOT_TOKEN!, {
    chat_id: chatId,
    text: 'Выберите доску для выполнения команды:',
    reply_markup: keyboard,
  });
}

/**
 * Handle inline button callback queries.
 * Supports: select_ws:<wsId>, select_ws:<wsId>:<command>, select_ws:<wsId>:draft
 * All processing happens IN THE SAME REQUEST — no pending state needed.
 */
async function handleCallbackQuery(callbackQuery: any): Promise<void> {
  const token = BOT_TOKEN!;
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const userId = callbackQuery.from?.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQuery.id,
      text: 'Неизвестная ошибка',
      show_alert: true,
    });
    return;
  }

  // Answer callback query immediately (Telegram gives 30s timeout)
  // NOTE: if the callback is stale (>30s), Telegram returns 400 — must NOT kill the flow
  try {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQuery.id,
    });
  } catch (err) {
    console.warn('[Bot Webhook] answerCallbackQuery failed (stale callback):', err);
  }

  // Parse callback_data
  const parsed = parseWorkspaceCallbackData(data);
  if (!parsed.workspaceId) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQuery.id,
      text: 'Неверный формат кнопки',
      show_alert: true,
    });
    return;
  }

  const { workspaceId, type, extra } = parsed;

  // Get workspace details (needed for slug in task cards)
  const { data: wsData } = await supabase
    .from('workspaces')
    .select('slug, name')
    .eq('id', workspaceId)
    .maybeSingle();

  if (!wsData) {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: '⚠️ Рабочее пространство не найдено.',
    });
    return;
  }

  // Update message with confirmation
  // NOTE: editMessageText can fail if the message was already edited — must not kill the flow
  try {
    await editMessageText(token, {
      chat_id: chatId,
      message_id: messageId,
      text: `✅ Выбрано рабочее пространство: <b>${escapeHtml(wsData.name || wsData.slug)}</b>`,
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.warn('[Bot Webhook] editMessageText failed:', err);
  }

  // Execute based on type
  if (type === 'command') {
    // Command mode: extra = "command" or "command:arg"
    await executeCommandInWorkspace(token, chatId, userId, workspaceId, extra);
  } else if (type === 'draft') {
    // Draft mode: no extra needed — consume latest draft by chat_id
    await executeDraftInWorkspaceByChat(token, chatId, userId, workspaceId);
  }

  console.log(`[Bot Webhook] User ${userId} selected workspace ${wsData?.slug || ''} (${workspaceId}), type=${type}, extra=${extra}`);
}

/**
 * Execute a command in the selected workspace (one-phase, no pending state).
 * Handles: task:<id> (lookup by full_id)
 */
async function executeCommandInWorkspace(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  extra: string
): Promise<void> {
  // Parse command and optional arg from extra
  // Format: "command" or "command:arg"
  const colonIdx = extra.indexOf(':');
  let command: string;
  let args: string;

  if (colonIdx >= 0) {
    command = extra.substring(0, colonIdx);
    args = extra.substring(colonIdx + 1);
  } else {
    command = extra;
    args = '';
  }

  const fakeMessage = {
    chat: { id: chatId },
    from: { id: userId },
    text: `/${command}${args ? ' ' + args : ''}`,
  };

  await handleCommand(fakeMessage as any, command, args, workspaceId);
}

/**
 * Execute a task draft in the selected workspace using F-04 AI pipeline.
 * Calls POST /api/bot/create-task which runs Groq parse + enrichment.
 * This is the primary path for /task flow with board selection.
 */
async function executeDraftInWorkspaceByChat(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string
): Promise<void> {
  console.log('[Bot Webhook] executeDraftInWorkspaceByChat:', { chatId, userId, workspaceId });

  // Consume latest active draft atomically (reads and deletes in one transaction)
  const { data: draft, error } = await supabase.rpc('consume_latest_bot_task_draft', {
    p_chat_id: chatId,
  });

  if (error || !draft || draft.length === 0) {
    console.warn('[Bot Webhook] Draft not found or expired:', { chatId, error });
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик не найден или истёк. Пожалуйста, отправьте задачу заново через /task.',
    });
    return;
  }

  const draftRow = draft[0];
  if (!draftRow.title) {
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Черновик пустой. Пожалуйста, отправьте задачу заново через /task.',
    });
    return;
  }

  const taskText = draftRow.title;

  // Call F-04 create-task endpoint (same pipeline as TWA)
  // Use relative path — both endpoints are in the same Next.js app on Vercel

  let aiResult: {
    task?: { id: string; title: string; column: string; priority: string };
    parse?: { rewritten_title?: string; clarity_score?: number };
    showCorrectionSheet?: boolean;
  };

  try {
    // Use relative path — webhook and create-task are in the same Next.js app
    const resp = await fetch('/api/bot/create-task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        telegram_user_id: userId,
        workspace_id: workspaceId,
        text: taskText,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      console.error('[Bot Webhook] /api/bot/create-task failed:', resp.status, errBody);
      throw new Error(errBody.error || `HTTP ${resp.status}`);
    }

    aiResult = await resp.json();
  } catch (err) {
    console.error('[Bot Webhook] F-04 create-task call failed:', err);
    // Fallback: create task directly without AI enrichment
    await createTaskFallback(token, chatId, userId, workspaceId, draftRow);
    return;
  }

  const task = aiResult.task;
  if (!task) {
    console.error('[Bot Webhook] No task returned from F-04');
    await sendMessage(token, {
      chat_id: chatId,
      text: '⚠️ Задача не создана. Попробуйте ещё раз.',
    });
    return;
  }

  // Get full_id
  const { data: wsWithPrefix } = await supabase
    .from('workspaces')
    .select('task_prefix, slug')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: taskWithNumber } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsWithPrefix?.task_prefix || '?'}-${taskWithNumber?.task_number || '?'}`;
  console.log('[Bot Webhook] Task created via F-04:', { taskId: task.id, fullId, chatId });

  // Build unified task card using buildTaskCard() from lib/bot.ts
  const cardData: TaskCardData = {
    fullId,
    title: task.title,
    column: task.column,
    isInbox: false,
    isBlocked: false,
    priority: task.priority as 'high' | 'medium' | 'low' | null,
    dueDate: null,
    assigneeName: null,
    workspaceHandle: wsWithPrefix?.slug || '',
    clarityScore: aiResult.parse?.clarity_score ?? null,
  };

  const taskCard = buildTaskCard(cardData, 'created');

  // Send confirmation with unified task card
  try {
    await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });
  } catch (err) {
    console.error('[Bot Webhook] sendMessage (task card) failed:', err);
    try {
      await sendMessage(token, {
        chat_id: chatId,
        text: `✅ Задача создана: ${fullId} · «${task.title}»`,
      });
    } catch (err2) {
      console.error('[Bot Webhook] sendMessage (fallback) failed:', err2);
    }
  }
}

/**
 * Fallback: create task directly without AI when /api/bot/create-task fails.
 * Used when F-04 pipeline is unavailable.
 */
async function createTaskFallback(
  token: string,
  chatId: number,
  userId: number,
  workspaceId: string,
  draftRow: any
): Promise<void> {
  // Resolve worker_id for created_by
  let createdBy: string | null = null;
  if (draftRow.user_id) {
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', draftRow.user_id)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle();
    createdBy = worker?.id ?? null;
  }

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      title: draftRow.title,
      description: draftRow.description || null,
      source: draftRow.source || 'bot',
      created_by: createdBy,
      is_inbox: false,
      column: 'backlog',
      priority: 'medium',
      version: 0,
    })
    .select('id, title, column, priority, version')
    .single();

  if (taskError || !task) {
    console.error('[Bot Webhook] Fallback task creation failed:', taskError);
    await sendMessage(token, {
      chat_id: chatId,
      text: `⚠️ Не удалось создать задачу: ${taskError?.message || 'неизвестная ошибка'}`,
    });
    return;
  }

  const { data: wsForFallback } = await supabase
    .from('workspaces')
    .select('task_prefix, slug')
    .eq('id', workspaceId)
    .maybeSingle();

  const { data: taskWithNumber2 } = await supabase
    .from('tasks')
    .select('task_number')
    .eq('id', task.id)
    .maybeSingle();

  const fullId = `${wsForFallback?.task_prefix || '?'}-${taskWithNumber2?.task_number || '?'}`;
  console.log('[Bot Webhook] Task created via fallback:', { taskId: task.id, fullId, chatId });

  // Build unified task card for fallback path too
  const cardData: TaskCardData = {
    fullId,
    title: task.title,
    column: task.column,
    isInbox: false,
    isBlocked: false,
    priority: task.priority as 'high' | 'medium' | 'low' | null,
    dueDate: null,
    assigneeName: null,
    workspaceHandle: wsForFallback?.slug || '',
    clarityScore: null,
  };

  const taskCard = buildTaskCard(cardData, 'created');

  try {
    await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });
  } catch (err) {
    console.error('[Bot Webhook] sendMessage (fallback) failed:', err);
  }
}

/**
 * Check if a string looks like a task full_id (e.g., ALPHA-123).
 */
function looksLikeTaskFullId(text: string): boolean {
  return /^[A-Z]{2,6}-\d{1,6}$/.test(text.trim());
}

/**
 * Handle /run-task TASK-123 lookup command — resolve and show unified card.
 * v0.6.5 spec §5.3: reactions 👀→✅/❌
 */
async function handleResolveTask(
  token: string,
  chatId: number,
  userId: number,
  messageId: number,
  fullId: string
): Promise<void> {
  // Reaction 👀 at start (spec §5.3)
  await setMessageReaction(token, chatId, messageId, '👀').catch(() => {});

  try {
    // Fetch task card data via RPC get_task_card_data by full_id
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: cardData, error: rpcError } = await supabase.rpc(
      'get_task_card_data_by_full_id',
      { p_full_id: fullId }
    );

    if (rpcError || !cardData) {
      console.error('[Bot Webhook] get_task_card_data_by_full_id error:', rpcError);
      await sendMessage(token, {
        chat_id: chatId,
        text: `⚠️ Задача ${escapeHtml(fullId)} не найдена. Проверьте формат (например, ALPHA-123).`,
        parse_mode: 'HTML',
      });
      // Reaction ❌ on error
      await setMessageReaction(token, chatId, messageId, '❌').catch(() => {});
      return;
    }

    // Build unified task card with buildTaskCard()
    const taskCard = buildTaskCard(cardData as TaskCardData, 'lookup');

    await sendMessage(token, {
      chat_id: chatId,
      text: taskCard.text,
      parse_mode: 'HTML',
      reply_markup: taskCard.replyMarkup,
    });

    // Reaction ✅ on success
    await setMessageReaction(token, chatId, messageId, '✅').catch(() => {});
  } catch (err) {
    console.error('[Bot Webhook] handleResolveTask error:', err);
    await sendMessage(token, {
      chat_id: chatId,
      text: `⚠️ Ошибка при поиске задачи ${escapeHtml(fullId)}.`,
      parse_mode: 'HTML',
    });
    await setMessageReaction(token, chatId, messageId, '❌').catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  // 1. Verify webhook secret token
  const providedSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');

  if (!WEBHOOK_SECRET) {
    console.error('[Bot Webhook] TELEGRAM_BOT_SECRET not configured');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  if (!providedSecret || !verifyTelegramWebhookSecret(providedSecret, WEBHOOK_SECRET)) {
    console.warn('[Bot Webhook] Invalid secret token');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 2. Parse update payload
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  // 3. Fire-and-forget dispatch using setImmediate (Node.js runtime on Vercel)
  //    Edge runtime would use env.waitUntil(), but we're on Node.js.
  setImmediate(() => {
    dispatchUpdate(update as any).catch((err) => {
      console.error('[Bot Webhook] Unhandled dispatch error:', err);
    });
  });

  // Return immediately — don't wait for async processing
  return NextResponse.json({ ok: true });
}
