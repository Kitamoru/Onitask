'use server';

import { parseStartParam } from '@/lib/taskLaunch';
import type { TaskLaunchTab, TaskLaunchTarget } from '@/lib/taskLaunch';

interface SupabaseLike {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => any;
    };
  };
}

/**
 * Resolve a human task reference to an authorized target for the TWA.
 * The task's own workspace is the source of truth; active workspace is irrelevant.
 */
export async function resolveTaskLaunchTarget(
  supabase: SupabaseLike,
  profileId: string,
  fullId: string,
  tab: TaskLaunchTab,
): Promise<TaskLaunchTarget | null> {
  const { data: taskId, error: taskIdError } = await supabase.rpc('find_task_by_full_id', {
    p_full_id: fullId,
  });
  if (taskIdError || typeof taskId !== 'string' || !taskId) return null;

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, workspace_id')
    .eq('id', taskId)
    .maybeSingle();
  if (taskError || !task?.workspace_id) return null;

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, slug')
    .eq('id', task.workspace_id)
    .maybeSingle();
  if (!workspace) return null;

  const { data: membership } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', task.workspace_id)
    .eq('is_active', true)
    .maybeSingle();
  if (!membership) return null;

  return {
    kind: 'task',
    taskId: task.id,
    workspaceId: task.workspace_id,
    workspaceSlug: workspace.slug,
    fullId: `${fullId}`,
    tab,
  };
}

export async function resolveFlowLaunchTarget(
  supabase: SupabaseLike,
  profileId: string,
  slug: string,
): Promise<{ kind: 'flow'; workspaceId: string; workspaceSlug: string } | null> {
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (!workspace?.id || !workspace.slug) return null;

  const { data: membership } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', workspace.id)
    .eq('is_active', true)
    .maybeSingle();
  return membership
    ? { kind: 'flow', workspaceId: workspace.id, workspaceSlug: workspace.slug }
    : null;
}
