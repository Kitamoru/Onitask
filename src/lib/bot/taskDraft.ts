// src/lib/bot/taskDraft.ts — Общие хелперы для pending-состояния /task flow
// Единый путь создания задачи через черновик (bot_task_drafts)
// Заменяет старый usage «Использование: /task ALPHA-123...»

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Special title used as a marker for "pending task" mode.
 * When this row exists in bot_task_drafts for a chat_id,
 * the user is expected to send text or voice next.
 */
export const PENDING_TASK_MARKER_TITLE = '__PENDING_TASK__';

/**
 * Set pending task mode for a chat.
 * Inserts a special marker row that signals the webhook to expect
 * the next message as the task description.
 */
export async function setPendingTask(chatId: number): Promise<void> {
  await supabase.from('bot_task_drafts').insert({
    chat_id: chatId,
    user_id: null, // Not yet resolved
    title: PENDING_TASK_MARKER_TITLE,
    description: null,
    source: 'pending',
    expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
  });
}

/**
 * Clear pending task marker for a chat.
 * Removes the __PENDING_TASK__ row so the chat exits pending mode.
 */
export async function clearPendingTask(chatId: number): Promise<void> {
  await supabase
    .from('bot_task_drafts')
    .delete()
    .eq('chat_id', chatId)
    .eq('title', PENDING_TASK_MARKER_TITLE);
}

/**
 * Check if a chat is in "pending task" mode.
 * Returns true if a pending marker exists and is not expired.
 */
export async function isPendingTaskMode(chatId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('bot_task_drafts')
    .select('id')
    .eq('chat_id', chatId)
    .eq('title', PENDING_TASK_MARKER_TITLE)
    .eq('source', 'pending')
    .maybeSingle();

  if (error || !data) return false;
  return true;
}