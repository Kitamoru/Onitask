// src/lib/bot/taskHandler.ts — `/task` текст+голос (BOT-03)
// Conforms to docs/onitask_bot.md §5 (Create Task + Resolve Task)
// Uses dedup_key column, buildTaskCard() RPC, and real transcription

import { createClient } from '@supabase/supabase-js';
import type { Message } from '../../../types/telegram';
import {
  sendRichMessage,
  sendRichMessageDraft,
  sendEphemeralRichMessage,
  deleteEphemeralMessage,
  getVoiceFileUrl as getVoiceFileUrlLib,
  buildTaskCard,
  escapeHtml,
  TaskCardData,
} from '../../../lib/bot';
// Workspace resolution is done via resolveWorkspace() from workspaceResolver.ts
// Freemium check is done via checkFreemiumBoundary() from freemium.ts

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ============================================================================
// Text Task Handler
// ============================================================================

/**
 * Handle a text /task command or @onitask inline query.
 * Flow: ephemeral thinking → parse → dedup → create → card confirm
 */
export async function handleTextTask(
  msg: Message,
  text: string,
  workspaceId: string
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  const messageId = msg.message_id;

  // 1. Ephemeral thinking (видит только пользователь)
  let ephemeralMsgId: number | undefined;
  try {
    const ephemeral = await sendEphemeralRichMessage(
      BOT_TOKEN!,
      chatId,
      '<tg-thinking>📝 Обрабатываю задачу...</tg-thinking>',
      userId
    );
    ephemeralMsgId = ephemeral.message_id;
  } catch {
    // Ephemeral not supported — continue without it
  }

  // 2. Parse task from text
  const parsed = await parseTaskFromText(text, workspaceId);
  if (!parsed) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось распознать задачу. Попробуйте переформулировать.' },
    });
    cleanupEphemeral(ephemeralMsgId);
    return;
  }

  // 3. Duplicate guard via dedup_key
  const dedupKey = `${workspaceId}:${userId}:${truncate(parsed.title, 50)}`;
  const isDup = await checkDuplicateByDedupKey(dedupKey);
  if (isDup) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '✅ Задача уже зафиксирована.' },
    });
    cleanupEphemeral(ephemeralMsgId);
    return;
  }

  // 4. Create task via POST /api/ai/create-task
  const createdTask = await createTaskFromParsed(parsed, {
    source: 'bot',
    dedup_key: dedupKey,
    chat_id: String(chatId),
    telegram_user_id: String(userId),
  });

  // 5. Final rich confirmation with buildTaskCard
  if (createdTask) {
    const cardData = await fetchTaskCardData(createdTask.id);
    if (cardData) {
      const taskCard = buildTaskCard(cardData, 'created');
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: taskCard.text },
        reply_markup: taskCard.replyMarkup,
      });
    } else {
      // Fallback if RPC fails
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: `✅ Задача создана: ${escapeHtml(parsed.title)}` },
      });
    }
  } else {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось создать задачу. Попробуйте позже.' },
    });
  }

  // 6. Cleanup ephemeral
  cleanupEphemeral(ephemeralMsgId);
}

// ============================================================================
// Voice Task Handler
// ============================================================================

/**
 * Handle a voice /task command.
 * Flow: transcribe → parse → dedup → create → card confirm
 */
export async function handleVoiceTask(
  msg: Message,
  workspaceId: string
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  const messageId = msg.message_id;
  const voice = msg.voice || msg.audio; // Support both voice and audio types

  if (!voice) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      text: '⚠️ Голосовое сообщение не найдено.',
    });
    return;
  }

  // 1. Ephemeral thinking
  let ephemeralMsgId: number | undefined;
  try {
    const ephemeral = await sendEphemeralRichMessage(
      BOT_TOKEN!,
      chatId,
      '<tg-thinking>🎤 Распознаю голосовое...</tg-thinking>',
      userId
    );
    ephemeralMsgId = ephemeral.message_id;
  } catch { /* skip */ }

  // 2. Draft streaming — transcription in progress
  const draftId = `draft_${messageId}_${Date.now()}`;
  try {
    await sendRichMessageDraft(BOT_TOKEN!, {
      chat_id: chatId,
      draft_id: draftId,
      rich_message: { html: '<tg-thinking>⏳ Транскрибирую...</tg-thinking>' },
    });
  } catch { /* skip draft if not supported */ }

  try {
    // 3. Download voice file using lib/bot.ts getVoiceFileUrl
    const fileId = (voice as { file_id?: string }).file_id || (voice as { file_unique_id?: string }).file_unique_id;
    const audioUrl = await getVoiceFileUrlLib(BOT_TOKEN!, fileId || '');
    
    if (!audioUrl) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: '⚠️ Не удалось скачать голосовое сообщение.' },
      });
      return;
    }

    // 4. Transcribe via POST /api/ai/transcribe
    const transcript = await transcribeAudio(audioUrl);
    if (!transcript || !transcript.trim()) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: '⚠️ Не удалось разобрать аудио — попробуйте ещё раз или напишите текстом.' },
      });
      return;
    }

    // 5. Draft streaming — parsing in progress
    try {
      await sendRichMessageDraft(BOT_TOKEN!, {
        chat_id: chatId,
        draft_id: draftId,
        rich_message: { html: '<tg-thinking>📝 Парсю задачу...</tg-thinking>' },
      });
    } catch { /* skip */ }

    // 6. Parse task from transcript
    const parsed = await parseTaskFromText(transcript, workspaceId);
    if (!parsed) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: '⚠️ Не удалось распознать задачу. Попробуйте переформулировать.' },
      });
      return;
    }

    // 7. Duplicate guard via dedup_key
    const dedupKey = `${workspaceId}:${userId}:${truncate(parsed.title, 50)}`;
    const isDup = await checkDuplicateByDedupKey(dedupKey);
    if (isDup) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: '✅ Задача уже зафиксирована.' },
      });
      return;
    }

    // 8. Create task
    const createdTask = await createTaskFromParsed(parsed, {
      source: 'bot',
      dedup_key: dedupKey,
      chat_id: String(chatId),
      telegram_user_id: String(userId),
    });

    // 9. Final rich confirmation with buildTaskCard
    if (createdTask) {
      const cardData = await fetchTaskCardData(createdTask.id);
      if (cardData) {
        const taskCard = buildTaskCard(cardData, 'created');
        await sendRichMessage(BOT_TOKEN!, {
          chat_id: chatId,
          rich_message: { html: taskCard.text },
          reply_markup: taskCard.replyMarkup,
        });
      }
    }
  } catch (err) {
    console.error('[Bot Task] Voice task error:', err);
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось создать задачу. Попробуйте позже или напишите текстом.' },
    });
  } finally {
    // 10. Cleanup ephemeral
    cleanupEphemeral(ephemeralMsgId);
  }
}

// ============================================================================
// Inline Query Handler
// ============================================================================

/**
 * Handle @onitask inline query.
 */
export async function handleInlineTask(
  query: string,
  inlineQuery: { id: string; from: { id: number; first_name?: string }; chat_type?: string },
  workspaceId: string
): Promise<void> {
  const chatId = inlineQuery.from.id;
  const messageId = parseInt(inlineQuery.id.slice(-10), 16) || Date.now();

  await handleTextTask(
    {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: inlineQuery.chat_type === 'private' ? 'private' : 'private' },
      from: { id: inlineQuery.from.id, is_bot: false, first_name: inlineQuery.from.first_name },
      text: query,
    } as Message,
    query,
    workspaceId
  );
}

// ============================================================================
// Workspace Resolution (executeDraftInWorkspaceByChat pattern)
// ============================================================================

/**
 * Resolve workspace for a given chat_id.
 * Uses the same pattern as executeDraftInWorkspaceByChat from webhook route.
 */
export async function resolveWorkspaceByChat(chatId: number | string): Promise<{
  workspaceId: string;
  resolved: boolean;
}> {
  // Try to find existing binding from bot_task_drafts or workspace_telegram_chats
  const { data: bindings } = await supabase
    .from('workspace_telegram_chats')
    .select('workspace_id')
    .eq('chat_id', typeof chatId === 'number' ? chatId : parseInt(chatId))
    .limit(1);

  if (bindings?.[0]?.workspace_id) {
    return { workspaceId: bindings[0].workspace_id, resolved: true };
  }

  // Fallback: use default workspace from user profile
  return { workspaceId: '', resolved: false };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Check for duplicate by dedup_key column (§6.2a).
 */
async function checkDuplicateByDedupKey(dedupKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .eq('dedup_key', dedupKey)
    .limit(1);

  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Transcribe audio via POST /api/ai/transcribe.
 * Downloads audio to blob, sends as form-data.
 */
async function transcribeAudio(audioUrl: string): Promise<string> {
  try {
    // Download audio file
    const response = await fetch(audioUrl);
    if (!response.ok) {
      console.error('[Bot Task] Failed to download audio:', response.status);
      return '';
    }

    const blob = await response.blob();
    
    // Prepare form-data for transcription API
    const formData = new FormData();
    formData.append('audio', blob, 'voice.ogg');
    formData.append('language', 'ru');

    // Call transcription endpoint
    const transcribeResponse = await fetch('/api/ai/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!transcribeResponse.ok) {
      console.error('[Bot Task] Transcription failed:', transcribeResponse.status);
      return '';
    }

    const result = await transcribeResponse.json();
    return result.text ?? result.transcript ?? '';
  } catch (err) {
    console.error('[Bot Task] Transcription error:', err);
    return '';
  }
}

/**
 * Parse task from text using deterministic extraction.
 * Supports formats:
 *   - "Задача: описание"
 *   - "Описание задачи"
 *   - "@onitask Описание"
 *   - Plain text as title
 */
async function parseTaskFromText(
  text: string,
  workspaceId: string
): Promise<{
  title: string;
  description?: string;
  deadline?: string;
} | null> {
  const cleaned = text
    .replace(/^\/task\s*/, '')
    .replace(/^@onitask\s*/, '')
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  if (cleaned.length > 100) return null; // Title limit

  // Extract deadline if present (e.g., "[до завтра]", "[2024-01-15]")
  let description = cleaned;
  const deadlineMatch = cleaned.match(/\[(?:до\s+)?([^]]+)\]/i);
  if (deadlineMatch) {
    description = cleaned.replace(deadlineMatch[0], '').trim();
  }

  if (!description || description.length < 2) return null;

  return {
    title: description.slice(0, 100),
    ...(deadlineMatch && { deadline: deadlineMatch[1] }),
  };
}

/**
 * Create task via POST /api/ai/create-task.
 */
async function createTaskFromParsed(
  parsed: {
    title: string;
    description?: string;
    deadline?: string;
  },
  metadata: Record<string, string>
): Promise<{ id: string } | null> {
  try {
    const requestBody: Record<string, unknown> = {
      title: parsed.title,
      workspace_id: metadata.workspace_id || '',
    };

    if (parsed.description) {
      requestBody.description = parsed.description;
    }

    if (parsed.deadline) {
      requestBody.deadline = parsed.deadline;
    }

    // Add bot-specific metadata
    requestBody.metadata = {
      source: metadata.source,
      dedup_key: metadata.dedup_key,
      chat_id: metadata.chat_id,
      telegram_user_id: metadata.telegram_user_id,
    };

    const response = await fetch('/api/ai/create-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error('[Bot Task] Create task failed:', response.status);
      return null;
    }

    const result = await response.json();
    return { id: result.id };
  } catch (err) {
    console.error('[Bot Task] Create task error:', err);
    return null;
  }
}

/**
 * Fetch task card data via RPC get_task_card_data.
 */
async function fetchTaskCardData(taskId: string): Promise<TaskCardData | null> {
  try {
    const response = await supabase.rpc('get_task_card_data', {
      p_task_id: taskId,
    });

    if (response.error || !response.data) {
      console.error('[Bot Task] get_task_card_data error:', response.error);
      return null;
    }

    return response.data as TaskCardData;
  } catch (err) {
    console.error('[Bot Task] fetchTaskCardData error:', err);
    return null;
  }
}

/**
 * Cleanup ephemeral message.
 */
function cleanupEphemeral(ephemeralMsgId: number | undefined): void {
  if (ephemeralMsgId) {
    deleteEphemeralMessage(BOT_TOKEN!, 0, ephemeralMsgId).catch(() => {});
  }
}

/**
 * Truncate string to limit.
 */
function truncate(str: string, limit: number): string {
  return str.length > limit ? str.slice(0, limit) : str;
}