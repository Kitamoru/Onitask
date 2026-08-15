// src/lib/bot/freemium.ts — Freemium Boundary Check (BOT-05+)
// bot_.md §4 — проверка тарифа перед выполнением команд
//
// FIX: getUserPlanType теперь использует resolveProfileId для корректного
// поиска workers по source_id = profile.id, а не telegram_user_id.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Plan types for freemium boundary.
 */
export type PlanType = 'free' | 'solo' | 'ai_dev' | 'team';

/**
 * Commands available per plan.
 * bot_.md §4 table.
 */
const PLAN_COMMANDS: Record<PlanType, string[]> = {
  free: ['help'],
  solo: ['help', 'task', 'inbox', 'flow', 'standup', 'resolve', 'stuck'],
  ai_dev: ['help', 'task', 'inbox', 'flow', 'standup', 'resolve', 'stuck', 'summary', 'who', 'load', 'review'],
  team: ['help', 'task', 'inbox', 'flow', 'standup', 'resolve', 'stuck', 'summary', 'who', 'load', 'review'],
};

/**
 * Check if a command is available for the given plan.
 */
export function isCommandAvailable(command: string, plan: PlanType): boolean {
  const available = PLAN_COMMANDS[plan]?.includes(command);
  return available ?? false;
}

/**
 * Get the freemium gate message HTML.
 */
export function getFreemiumGateMessage(command: string): string {
  return `<tg-callout>Создание задач через бот доступно с плана Solo (290₽/мес). Перейти: [ссылка на TWA настройки]</tg-callout>`;
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

/**
 * Get user's plan type by workspace_id.
 * Checks workspaces.plan column.
 * FIX: Uses resolveProfileId to find workers by correct source_id.
 */
export async function getUserPlanType(
  telegramUserId: number,
  workspaceId: string
): Promise<PlanType> {
  // Resolve profile first — this is the key fix
  const profileId = await resolveProfileId(telegramUserId);
  if (!profileId) return 'free';

  // Check if user is a worker in this workspace (using resolved profile UUID)
  const { data: worker } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', profileId)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  if (!worker) return 'free';

  // Get workspace plan
  const { data: ws } = await supabase
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .maybeSingle();

  return (ws?.plan as PlanType) ?? 'free';
}

/**
 * Check plan and return gate message if command is not available.
 * Returns null if command is allowed.
 */
export async function checkFreemiumBoundary(
  command: string,
  telegramUserId: number,
  workspaceId: string
): Promise<string | null> {
  const plan = await getUserPlanType(telegramUserId, workspaceId);

  if (isCommandAvailable(command, plan)) {
    return null; // Allowed
  }

  return getFreemiumGateMessage(command);
}