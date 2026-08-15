// src/lib/bot/taskHandler.ts — `/task` текст+голос (BOT-03)
// Rich Messages + Draft Streaming + Ephemeral + Duplicate Guard
// bot_.md §5.1, §6.2

import { createClient } from '@supabase/supabase-js';
import {
  sendRichMessage,
  sendRichMessageDraft,
  sendEphemeralRichMessage,
  deleteEphemeralMessage,
  buildTaskCardHTML,
  buildTaskConfirmationKeyboard,
  escapeHtml,
} from '../../../lib/bot';
import type { Message, InlineQuery } from '../../../types/telegram';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_MESSAGE_LENGTH = 4096;

// ============================================================================
// Text Task Handler
// ============================================================================

/**
 * Handle a text /task command or @onitask inline query.
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
    return;
  }

  // 3. Duplicate guard (metadata.message_id)
  const isDup = await checkDuplicate(messageId, userId);
  if (isDup) {
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '✅ Задача уже зафиксирована.' },
    });
    return;
  }

  // 4. Create task via POST /api/ai/create-task
  const createdTask = await createTaskFromParsed(parsed, {
    source: 'telegram_bot',
    message_id: String(messageId),
    chat_id: String(chatId),
    telegram_user_id: String(userId),
  });

  // 5. Final rich confirmation
  const taskCard = createdTask ? buildTaskCardHTML(createdTask) : '✅ Задача создана!';
  await sendRichMessage(BOT_TOKEN!, {
    chat_id: chatId,
    rich_message: { html: taskCard.slice(0, MAX_MESSAGE_LENGTH) },
    reply_markup: buildTaskConfirmationKeyboard(createdTask?.full_id || ''),
  });

  // 6. Cleanup ephemeral
  if (ephemeralMsgId) {
    await deleteEphemeralMessage(BOT_TOKEN!, chatId, ephemeralMsgId).catch(() => {});
  }
}

// ============================================================================
// Voice Task Handler
// ============================================================================

/**
 * Handle a voice /task command.
 * Flow: transcribe → parse → create → confirm
 */
export async function handleVoiceTask(
  msg: Message,
  workspaceId: string
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  const messageId = msg.message_id;
  const voice = msg.voice;

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
    // 3. Download voice file
    const audioUrl = await getVoiceFileUrl(voice.file_id);
    
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

    // 7. Duplicate guard
    const isDup = await checkDuplicate(messageId, userId);
    if (isDup) {
      await sendRichMessage(BOT_TOKEN!, {
        chat_id: chatId,
        rich_message: { html: '✅ Задача уже зафиксирована.' },
      });
      return;
    }

    // 8. Create task
    const createdTask = await createTaskFromParsed(parsed, {
      source: 'telegram_bot',
      message_id: String(messageId),
      chat_id: String(chatId),
      telegram_user_id: String(userId),
    });

    // 9. Final rich confirmation
    const taskCard = createdTask ? buildTaskCardHTML(createdTask) : '✅ Задача создана!';
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: taskCard.slice(0, MAX_MESSAGE_LENGTH) },
      reply_markup: buildTaskConfirmationKeyboard(createdTask?.full_id || ''),
    });
  } catch (err) {
    console.error('[Bot Task] Voice task error:', err);
    // Fallback на bot_.md §5.1: новое сообщение вместо редактирования
    await sendRichMessage(BOT_TOKEN!, {
      chat_id: chatId,
      rich_message: { html: '⚠️ Не удалось создать задачу. Попробуйте позже или напишите текстом.' },
    });
  } finally {
    // 10. Cleanup ephemeral
    if (ephemeralMsgId) {
      await deleteEphemeralMessage(BOT_TOKEN!, chatId, ephemeralMsgId).catch(() => {});
    }
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
  inlineQuery: InlineQuery,
  workspaceId: string
): Promise<void> {
  const chatId = inlineQuery.from.id;
  const messageId = inlineQuery.id;

  // Use same flow as text task
  await handleTextTask(
    {
      message_id: parseInt(messageId.slice(-10), 16) || Date.now(),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: inlineQuery.from.id, is_bot: false, first_name: inlineQuery.from.first_name },
      text: query,
    } as Message,
    query,
    workspaceId
  );
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Check for duplicate by message_id.
 */
async function checkDuplicate(
  messageId: number,
  telegramUserId: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .eq('metadata->>message_id', String(messageId))
    .eq('metadata->>source', 'telegram_bot')
    .limit(1);

  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Get public URL for a voice file.
 */
async function getVoiceFileUrl(fileId: string): Promise<string> {
  // Telegram Bot API: getFile endpoint
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/file_${fileId}`;
  return url;
}

/**
 * Transcribe audio via POST /api/ai/transcribe.
 */
async function transcribeAudio(audioUrl: string): Promise<string> {
  // TODO: Implement actual transcription
  // For now, return placeholder
  console.log('[Bot Task] Transcribing:', audioUrl);
  return '';
}

/**
 * Parse task from text using F-04 parse logic.
 */
async function parseTaskFromText(
  text: string,
  workspaceId: string
): Promise<{
  title: string;
  description?: string;
  column?: string;
  priority?: string;
  assignee_name?: string;
  deadline?: string;
} | null> {
  // TODO: Call POST /api/ai/parse-task or use deterministic parsing
  // For MVP: simple extraction
  const title = text.slice(0, 100);
  return { title };
}

/**
 * Create task via POST /api/ai/create-task.
 */
async function createTaskFromParsed(
  parsed: {
    title: string;
    description?: string;
    column?: string;
    priority?: string;
    assignee_name?: string;
    deadline?: string;
  },
  metadata: Record<string, string>
): Promise<{ full_id: string; title: string } | null> {
  // TODO: Call POST /api/ai/create-task with parsed data
  console.log('[Bot Task] Creating task:', parsed, metadata);
  
  // Return mock for now
  return {
    full_id: 'TBD-1',
    title: parsed.title,
  };
}