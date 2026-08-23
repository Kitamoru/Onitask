/**
 * Domain: create_task — mcp_contract v0.8.0 §4.3
 * DFS cycle check BEFORE insert. Rate limit via agent_events count.
 */

import { errors } from '../../shared/errors';
import type { AgentKeyContext } from '../../shared/mcpAuth';

export type CreateTaskInput = {
  workspaceId: string;
  agentName: string;
  title: string;
  description?: string;
  column?: 'backlog' | 'in_progress' | 'review';
  assignee?: string;
  tags?: string[];
  deadline?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  complexity?: 1 | 2 | 3;
  blocked_by?: string;
  key: AgentKeyContext;
};

export type CreateTaskResult = {
  success: true;
  task: {
    task_id: string;
    task_number: number;
    full_id: string;
    title: string;
    column: string;
    created_at: string;
    version: number;
    relation_created: boolean;
  };
};

type Deps = {
  supabase: any;
  createTaskRpc?: (params: Record<string, unknown>) => Promise<any>;
  wouldCreateCycle: (blockerId: string, workspaceId: string) => Promise<boolean>;
  reserveQuota?: (workspaceId: string, agentName: string) => Promise<void>;
  enqueueEnrichment?: (taskId: string) => Promise<void>;
};

export async function createTask(
  input: CreateTaskInput,
  deps: Deps
): Promise<CreateTaskResult> {
  const { supabase, wouldCreateCycle } = deps;
  const { workspaceId, agentName, key } = input;

  if (!input.title?.trim()) {
    throw errors.invalidParams('title is required.');
  }

  const { count, error: countErr } = await supabase
    .from('agent_events')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('agent_name', agentName)
    .eq('tool', 'create_task')
    .gt('created_at', new Date(Date.now() - 60_000).toISOString());

  if (countErr) throw errors.internal(countErr.message);
  if ((count ?? 0) >= key.maxTasksPerMinute) {
    throw errors.taskCreationRateLimit(key.maxTasksPerMinute);
  }

  if (deps.reserveQuota) {
    await deps.reserveQuota(workspaceId, agentName);
  }

  let relationCreated = false;
  if (input.blocked_by) {
    const { data: blocker, error: bErr } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', input.blocked_by)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (bErr) throw errors.internal(bErr.message);
    if (!blocker) throw errors.blockerNotFound();

    const cycle = await wouldCreateCycle(input.blocked_by, workspaceId);
    if (cycle) throw errors.circularDependency();
    relationCreated = true;
  }

  const column = input.column ?? 'backlog';
  const is_inbox = input.column == null;
  const raw_input = [input.title, input.description].filter(Boolean).join('\n');
  const complexity = input.complexity ?? 1;

  if (deps.createTaskRpc) {
    const row = await deps.createTaskRpc({
      p_workspace_id: workspaceId,
      p_title: input.title.trim(),
      p_description: input.description ?? null,
      p_column: column,
      p_is_inbox: is_inbox,
      p_assignee: input.assignee ?? null,
      p_tags: input.tags ?? [],
      p_deadline: input.deadline ?? null,
      p_priority: input.priority ?? 'medium',
      p_complexity: complexity,
      p_raw_input: raw_input,
      p_blocked_by: input.blocked_by ?? null,
      p_agent_name: agentName,
    });

    await logEvent(supabase, {
      workspaceId,
      agentName,
      tool: 'create_task',
      taskId: row.task_id,
      summary: `Created ${row.full_id}: ${row.title}`,
    });

    if (deps.enqueueEnrichment) void deps.enqueueEnrichment(row.task_id);

    return {
      success: true,
      task: {
        task_id: row.task_id,
        task_number: row.task_number,
        full_id: row.full_id,
        title: row.title,
        column: row.column,
        created_at: row.created_at,
        version: row.version ?? 1,
        relation_created: Boolean(row.relation_created ?? relationCreated),
      },
    };
  }

  const { data: task, error: insErr } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      title: input.title.trim(),
      description: input.description ?? null,
      column,
      is_inbox,
      assigned_to: input.assignee ?? null,
      tags: input.tags ?? [],
      deadline: input.deadline ?? null,
      priority: input.priority ?? 'medium',
      complexity,
      raw_input,
      clarity_score: null,
      enrichment_strategy: 'standard',
      cognitive_weight: 1,
      is_blocked: Boolean(input.blocked_by),
      version: 1,
    })
    .select('id, task_number, full_id, title, column, created_at, version')
    .single();

  if (insErr || !task) {
    throw errors.internal(insErr?.message ?? 'Failed to create task.');
  }

  if (input.blocked_by) {
    const { error: relErr } = await supabase.from('task_relations').insert({
      workspace_id: workspaceId,
      from_task_id: input.blocked_by,
      to_task_id: task.id,
      relation_type: 'blocks',
      weight: 1.0,
    });
    if (relErr) {
      await supabase.from('tasks').delete().eq('id', task.id);
      throw errors.internal(relErr.message);
    }
  }

  await logEvent(supabase, {
    workspaceId,
    agentName,
    tool: 'create_task',
    taskId: task.id,
    summary: `Created ${task.full_id}: ${task.title}`,
  });

  if (deps.enqueueEnrichment) void deps.enqueueEnrichment(task.id);

  return {
    success: true,
    task: {
      task_id: task.id,
      task_number: task.task_number,
      full_id: task.full_id,
      title: task.title,
      column: task.column,
      created_at: task.created_at,
      version: task.version,
      relation_created: relationCreated,
    },
  };
}

async function logEvent(
  supabase: any,
  opts: {
    workspaceId: string;
    agentName: string;
    tool: string;
    taskId: string;
    summary: string;
  }
) {
  await supabase.from('agent_events').insert({
    workspace_id: opts.workspaceId,
    agent_name: opts.agentName,
    tool: opts.tool,
    task_id: opts.taskId,
    summary: opts.summary,
    created_at: new Date().toISOString(),
  });
}
