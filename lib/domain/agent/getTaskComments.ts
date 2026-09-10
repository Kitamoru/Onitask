// lib/domain/agent/getTaskComments.ts
// FILE-08: read-only MCP tool — фид «Комментарии» задачи для duty poll
// (вариант A: агент при сканировании своих задач проверяет новые комментарии
// через обёртку над RPC get_task_feed, миг. 076). Не пишет agent_events
// (read-only контур, как get_task_context / get_tasks_by_column).

import { getSupabaseClient } from '../../shared/mcpAuth';
import { taskNotFound, internalError } from '../../shared/errors';
import type {
  GetTaskCommentsParams,
  GetTaskCommentsResult,
  DomainResult,
} from '../../shared/types';

export async function getTaskComments(
  params: GetTaskCommentsParams
): Promise<DomainResult<GetTaskCommentsResult>> {
  const { key } = params;
  const workspaceId = key.workspaceId;
  const supabase = getSupabaseClient();

  if (!params.task_id) throw internalError('task_id is required.');

  // Тенант-изоляция: задача должна принадлежать воркспейсу ключа (A-7)
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', params.task_id)
    .maybeSingle();
  if (taskError || !task) throw taskNotFound();

  const anySupabase = supabase as any;
  const { data, error } = await anySupabase.rpc('get_task_feed', {
    p_task_id: params.task_id,
    p_cursor_created: params.cursor_created ?? null,
    p_cursor_id: params.cursor_id ?? null,
    p_limit: Math.min(Math.max(params.limit ?? 30, 1), 100),
  });
  if (error) throw internalError(error.message);

  return {
    success: true,
    items: (data ?? []) as GetTaskCommentsResult['items'],
  };
}