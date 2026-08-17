// src/lib/bot/workspaceResolver.ts — Workspace Resolution (BOT-02)
// 4 приоритета определения workspace для Telegram пользователя
// bot_.md §3
//
// FIX: Все запросы к workers теперь используют profile.id как source_id,
// а не telegram_user_id напрямую. Резолюция профиля:
//   profiles.telegram_id → profiles.id → workers.source_id
//
// NO LAST-USED: Мы не запоминаем последнюю доску — каждый раз спрашиваем,
// если у пользователя несколько досок.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Worker = Database['public']['Tables']['workers']['Row'];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Resolve profile UUID from Telegram user ID.
 * This is the canonical resolution path used by all bot functions.
 * INV-10: workspace_telegram_chats.linked_by → profiles(id)
 */
export async function resolveProfileId(telegramUserId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle();

  if (error || !data) return null;
  return data.id; // UUID string like "a1b2c3d4-..."
}

/**
 * Resolve workspace for a Telegram user in a given chat context.
 *
 * Priorities:
 * 1. Single workspace → auto-use
 * 2. Linked chat → use binding from workspace_telegram_chats
 * 3. @workspace mention → explicit target
 * 4. Multiple workspaces → return null (caller shows inline buttons)
 *
 * NOTE: We intentionally do NOT remember last-used workspace.
 * Users may need info from different boards each time.
 */
export async function resolveWorkspace(
  telegramUserId: number,
  chatId: number,
  chatType: 'private' | 'group' | 'supergroup' | 'channel',
  /** Optional: extracted target_workspace from @mention or voice NLP */
  explicitTarget?: string
): Promise<{ workspace_id: string; slug: string } | null> {
  console.log('[Bot WS] resolveWorkspace START userId=' + telegramUserId + ' chatId=' + chatId + ' type=' + chatType);

  // Priority 3: Explicit @workspace mention
  if (explicitTarget) {
    const result = await findWorkspaceBySlug(explicitTarget);
    if (result) return result;
    // Not found — fall through to other priorities
  }

  // Priority 2: Check linked chat bindings (groups only)
  if (chatType !== 'private') {
    const linkedChat = await findLinkedChat(chatId);
    if (linkedChat) {
      return linkedChat;
    }
  }

  // Resolve profile first — this is the key fix
  console.log('[Bot WS] Calling resolveProfileId for userId=' + telegramUserId);
  let profileId: string | null;
  try {
    profileId = await resolveProfileId(telegramUserId);
    console.log('[Bot WS] resolveProfileId result:', profileId ? 'found' : 'null');
  } catch (err) {
    console.error('[Bot WS] ERROR resolveProfileId:', err);
    throw err;
  }
  if (!profileId) {
    // User has no profile — show available workspaces or general welcome
    console.log('[Bot WS] No profile found for userId=' + telegramUserId);
    return null;
  }

  // Priority 1: User has exactly one workspace → auto-use
  console.log('[Bot WS] Calling getUserWorkspaces for profileId=' + profileId);
  let userWorkspaces: Array<{ id: string; slug: string }>;
  try {
    userWorkspaces = await getUserWorkspaces(profileId);
    console.log('[Bot WS] getUserWorkspaces result count:', userWorkspaces.length);
  } catch (err) {
    console.error('[Bot WS] ERROR getUserWorkspaces:', err);
    throw err;
  }
  if (userWorkspaces.length === 1) {
    return { workspace_id: userWorkspaces[0].id, slug: userWorkspaces[0].slug };
  }

  // Priority 4: Multiple workspaces → return null (caller shows inline buttons)
  // We intentionally skip "last-used" here — users may need different boards each time.
  return null;
}

/**
 * Get all workspace IDs for a Telegram user (via workers table).
 * Uses resolved profile UUID as source_id.
 */
async function getUserWorkspaces(profileId: string): Promise<Array<{ id: string; slug: string }>> {
  const { data, error } = await supabase
    .from('workers')
    .select('workspace_id, workspaces(slug)')
    .eq('source_id', profileId)
    .eq('is_active', true);

  if (error || !data) return [];

  return data.map(w => ({
    id: w.workspace_id,
    slug: (w as any).workspaces?.slug || '',
  }));
}

/**
 * Find a linked chat for the given chat_id.
 * Returns the workspace_id and slug from workspace_telegram_chats.
 */
async function findLinkedChat(chatId: number): Promise<{ workspace_id: string; slug: string } | null> {
  const { data, error } = await supabase
    .from('workspace_telegram_chats')
    .select('workspace_id, workspaces(slug)')
    .eq('chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return {
    workspace_id: data.workspace_id,
    slug: (data as any).workspaces?.slug || '',
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
 * Uses resolved profile UUID as source_id.
 */
export async function getUserAvailableWorkspaces(
  telegramUserId: number
): Promise<Array<{ id: string; slug: string; title?: string }>> {
  const profileId = await resolveProfileId(telegramUserId);
  if (!profileId) return [];

  const { data, error } = await supabase
    .from('workers')
    .select('workspace_id, workspaces(slug, name)')
    .eq('source_id', profileId)
    .eq('is_active', true);

  if (error || !data) return [];

  return data.map(w => ({
    id: w.workspace_id,
    slug: (w as any).workspaces?.slug || '',
    title: (w as any).workspaces?.name || undefined,
  }));
}