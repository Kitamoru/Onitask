// src/lib/bot/workspaceResolver.ts — Workspace Resolution (BOT-02)
// 6 приоритетов определения workspace для Telegram пользователя
// bot_.md §3

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

type Workspace = Database['public']['Tables']['workspaces']['Row'];
type WorkspaceTelegramChat = Database['public']['Tables']['workspace_telegram_chats']['Row'];
type Worker = Database['public']['Tables']['workers']['Row'];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Resolve workspace for a Telegram user in a given chat context.
 * 
 * 6 Priorities (bot_.md §3):
 * 1. Single workspace → auto-use
 * 2. Linked chat → use binding from workspace_telegram_chats
 * 3. @workspace mention → explicit target
 * 4. Voice NLP → target_workspace from transcript
 * 5. Last-used → SQL lookup of most recent task
 * 6. No data → return null (caller shows inline buttons)
 */
export async function resolveWorkspace(
  telegramUserId: number,
  chatId: number,
  chatType: 'private' | 'group' | 'supergroup' | 'channel',
  /** Optional: extracted target_workspace from @mention or voice NLP */
  explicitTarget?: string
): Promise<{ workspace_id: string; slug: string } | null> {
  
  // Priority 3: Explicit @workspace mention
  if (explicitTarget) {
    const result = await findWorkspaceBySlug(explicitTarget);
    if (result) return result;
    // Not found — fall through to other priorities
  }
  
  // Priority 1 & 2: Check linked chat bindings
  if (chatType !== 'private') {
    const linkedChat = await findLinkedChat(chatId);
    if (linkedChat) {
      return { workspace_id: linkedChat.workspace_id, slug: '' }; // slug resolved below
    }
  }
  
  // Priority 1: User has exactly one workspace
  const userWorkspaces = await getUserWorkspaces(telegramUserId);
  if (userWorkspaces.length === 1) {
    return { workspace_id: userWorkspaces[0].id, slug: userWorkspaces[0].slug };
  }
  
  // Priority 5: Last-used workspace
  const lastUsed = await getLastUsedWorkspace(telegramUserId);
  if (lastUsed) {
    return lastUsed;
  }
  
  // Priority 6: No data — caller should show inline buttons
  return null;
}

/**
 * Get all workspace IDs for a Telegram user (via workers table).
 */
async function getUserWorkspaces(telegramUserId: number): Promise<Array<{ id: string; slug: string }>> {
  const { data, error } = await supabase
    .from('workers')
    .select('workspace_id, workspaces(slug)')
    .eq('source_id', String(telegramUserId))
    .eq('is_active', true);
  
  if (error || !data) return [];
  
  return data.map(w => ({
    id: w.workspace_id,
    slug: (w as any).workspaces?.slug || '',
  }));
}

/**
 * Find a linked chat for the given chat_id.
 * Returns the workspace_id from workspace_telegram_chats.
 */
async function findLinkedChat(chatId: number): Promise<{ workspace_id: string } | null> {
  const { data, error } = await supabase
    .from('workspace_telegram_chats')
    .select('workspace_id')
    .eq('chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();
  
  if (error || !data) return null;
  return data;
}

/**
 * Find last-used workspace for a Telegram user.
 * SQL: SELECT t.workspace_id FROM tasks t JOIN workers w ON ... ORDER BY t.created_at DESC LIMIT 1
 */
async function getLastUsedWorkspace(
  telegramUserId: number
): Promise<{ workspace_id: string; slug: string } | null> {
  const { data, error } = await supabase.rpc('get_last_used_workspace', {
    p_telegram_user_id: String(telegramUserId),
  });
  
  if (!error && data) {
    return { workspace_id: data.workspace_id, slug: data.slug };
  }
  
  // Fallback: get worker first, then their latest task
  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', String(telegramUserId))
    .eq('is_active', true)
    .maybeSingle();
  
  if (workerError || !worker) return null;
  
  const { data: latestTask, error: taskError } = await supabase
    .from('tasks')
    .select('workspace_id, workspaces(slug)')
    .eq('assigned_to', worker.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (taskError || !latestTask) return null;
  
  return {
    workspace_id: latestTask.workspace_id,
    slug: (latestTask as any).workspaces?.slug || '',
  };
}

/**
 * Find workspace by slug (for explicit @mention resolution).
 */
async function findWorkspaceBySlug(slug: string): Promise<{ workspace_id: string; slug: string } | null> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, slug')
    .ilike('slug', slug)
    .limit(1)
    .maybeSingle();
  
  if (error || !data) return null;
  return { workspace_id: data.id, slug: data.slug };
}

/**
 * Get all available workspaces for a Telegram user (for inline button selection).
 */
export async function getUserAvailableWorkspaces(
  telegramUserId: number
): Promise<Array<{ id: string; slug: string; title?: string }>> {
  const { data, error } = await supabase
    .from('workers')
    .select('workspace_id, workspaces(slug, title)')
    .eq('source_id', String(telegramUserId))
    .eq('is_active', true);
  
  if (error || !data) return [];
  
  return data.map(w => ({
    id: w.workspace_id,
    slug: (w as any).workspaces?.slug || '',
    title: (w as any).workspaces?.title || undefined,
  }));
}