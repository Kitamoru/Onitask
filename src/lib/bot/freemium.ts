// src/lib/bot/freemium.ts — Freemium Boundary Check (BOT-05+)
// bot_.md §4 — проверка тарифа перед выполнением команд

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
 * Get user's plan type by workspace_id.
 * Checks workspace_settings.plan_type.
 */
export async function getUserPlanType(
  telegramUserId: number,
  workspaceId: string
): Promise<PlanType> {
  // First, check if user is a worker in this workspace
  const { data: worker } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', String(telegramUserId))
    .eq('is_active', true)
    .maybeSingle();

  if (!worker) return 'free';

  // Get workspace settings
  const { data: settings } = await supabase
    .from('workspace_settings')
    .select('plan_type')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  return (settings?.plan_type as PlanType) ?? 'free';
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