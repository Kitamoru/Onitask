// lib/domain/agent/getWorkspaceSettings.ts
// MCP Contract v0.8.0 §4.2. Read-only — no quota.
// Includes agent_active_tasks: in_progress/review, needs_human=false.

import { getSupabaseClient } from '../../shared/mcpAuth';
import { internalError } from '../../shared/errors';
import { resolveDutyPlaybook } from '../../shared/dutyPlaybook';
import type {
  GetWorkspaceSettingsParams,
  GetWorkspaceSettingsResult,
  DomainResult,
  TaskPreview,
} from '../../shared/types';

export async function getWorkspaceSettings(
  params: GetWorkspaceSettingsParams
): Promise<DomainResult<GetWorkspaceSettingsResult>> {
  const { key, agentName } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  // INV-08: workspace_settings is the single source of settings
  const { data: settings, error } = await supabase
    .from('workspace_settings')
    .select(
      'enable_cognitive_budget, story_points_config, velocity_window_days, flow_config, realtime_subscription_level, workspace_context, workspace_context_cache, context_stale, doc_kb_config, agent_duty_playbook'
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error || !settings) {
    throw internalError('Workspace settings not found.');
  }

  // agent_active_tasks: in_progress/review assigned to this agent, needs_human=false
  let agentActiveTasks: TaskPreview[] | null = null;
  const { data: worker } = await supabase
    .from('workers')
    .select('id')
    // Agent workers use prefixed source_id per Master Spec §6.2 ('agent::<name>')
    .eq('source_id', `agent::${agentName}`)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (worker) {
    const { data: activeTasks } = await supabase
      .from('tasks')
      .select(
        'id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, full_id, task_number'
      )
      .eq('workspace_id', workspaceId)
      .in('column', ['in_progress', 'review'])
      .eq('assigned_to', worker.id as string)
      .eq('needs_human', false)
      .order('created_at', { ascending: true })
      .limit(50);

    agentActiveTasks = (activeTasks ?? []).map((t) => ({
      id: t.id as string,
      title: t.title as string,
      column: t.column as string,
      assigned_to: (t.assigned_to as string | null) ?? null,
      reviewer_id: (t.reviewer_id as string | null) ?? null,
      version: t.version as number,
      is_inbox: t.is_inbox as boolean,
      is_blocked: t.is_blocked as boolean,
      full_id: (t.full_id as string) ?? '',
      task_number: (t.task_number as number) ?? 0,
    }));
  }

  return {
    success: true,
    settings: {
      enable_cognitive_budget:
        (settings.enable_cognitive_budget as boolean) ?? false,
      story_points_config:
        (settings.story_points_config as Record<string, unknown>) ?? {},
      velocity_window_days: (settings.velocity_window_days as number) ?? 7,
      flow_config: (settings.flow_config as Record<string, unknown>) ?? {},
      realtime_subscription_level:
        (settings.realtime_subscription_level as 'own_tasks' | 'all') ??
        'own_tasks',
      workspace_context: (settings.workspace_context as string | null) ?? null,
      workspace_context_cache:
        (settings.workspace_context_cache as string | null) ?? null,
      context_stale: (settings.context_stale as boolean) ?? false,
      doc_kb_config:
        (settings.doc_kb_config as Record<string, unknown> | null) ?? null,
      agent_active_tasks: agentActiveTasks,
      // Duty Mode (migration 049): the calling key's tier + playbook resolved
      // server-side for that tier (Admin override or built-in default).
      autonomy_level: key.autonomyLevel,
      duty_playbook: resolveDutyPlaybook(
        key.autonomyLevel,
        settings.agent_duty_playbook
      ),
    },
  };
}