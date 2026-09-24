'use server';

/**
 * GET/POST /api/tasks/[id]/relations — explicit `blocks` relations (AGENT-04/09).
 * GET returns direct depth-1 blockers/downstream. POST accepts
 * { related_task_id, direction: 'blocked_by' | 'blocks' }. Tenant and active-worker
 * checks are resource-scoped; workspace_id, weight and created_by are server-owned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
  isWorkspaceMember,
} from '../../../../../../lib/api-auth';
import { enrichTaskRowsBatch } from '../../../../../../lib/taskEnrichment';
import type { Database } from '../../../../../../types/supabase';
import type { TaskRelationDirection } from '@/types/taskRelations';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type Params = { params: Promise<{ id: string }> };

function relationErrorStatus(message: string): number {
  switch (message) {
    case 'task_cannot_block_itself':
    case 'only_blocks_are_supported':
    case 'invalid_blocks_weight':
      return 400;
    case 'blocker_already_done':
    case 'circular_dependency':
      return 409;
    case 'relation_not_found':
    case 'task_not_in_workspace':
    case 'relation_not_for_task':
      return 404;
    default:
      return 500;
  }
}

function relationErrorMessage(message: string, duplicate = false): string {
  if (duplicate) return 'Связь уже существует';
  switch (message) {
    case 'task_cannot_block_itself':
      return 'Задача не может блокировать саму себя';
    case 'blocker_already_done':
      return 'Нельзя добавить завершённую задачу как блокера';
    case 'dependent_already_done':
      return 'Нельзя добавить связь к завершённой задаче';
    case 'circular_dependency':
      return 'Такая связь создаст циклическую зависимость';
    case 'task_not_in_workspace':
      return 'Задача не найдена на этой доске';
    default:
      return 'Не удалось создать связь';
  }
}

async function getAuthorizedTask(request: NextRequest, taskId: string) {
  const auth = await authenticateRequest(await extractInitData(request));
  if (!auth.authenticated) {
    return { error: NextResponse.json({ error: auth.error || 'Не авторизован' }, { status: auth.status || 401 }) };
  }

  const supabase = createServerClient();
  const { data: task, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!task) return { error: NextResponse.json({ error: 'Задача не найдена' }, { status: 404 }) };
  if (!(await isWorkspaceMember(auth.profileId!, task.workspace_id))) {
    return { error: NextResponse.json({ error: 'Задача не найдена' }, { status: 404 }) };
  }

  return { supabase, task, profileId: auth.profileId! };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id: taskId } = await params;
    const context = await getAuthorizedTask(request, taskId);
    if (context.error) return context.error;

    const { supabase, task } = context;
    const { data: edges, error: relationsError } = await supabase
      .from('task_relations')
      .select('id, from_task_id, to_task_id, relation_type')
      .eq('workspace_id', task.workspace_id)
      .eq('relation_type', 'blocks')
      .or(`from_task_id.eq.${taskId},to_task_id.eq.${taskId}`);
    if (relationsError) return NextResponse.json({ error: relationsError.message }, { status: 500 });

    const relatedIds = (edges ?? []).map((edge) =>
      edge.from_task_id === taskId ? edge.to_task_id : edge.from_task_id,
    );
    const uniqueIds = Array.from(new Set(relatedIds));
    if (uniqueIds.length === 0) return NextResponse.json({ blockers: [], downstream: [] });

    const { data: relatedRows, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', task.workspace_id)
      .in('id', uniqueIds);
    if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 });

    const enriched = await enrichTaskRowsBatch((relatedRows ?? []) as TasksRow[]);
    const taskById = new Map(enriched.map((row) => [row.id, row]));
    const mapItem = (edge: Record<string, unknown>, direction: 'blocked_by' | 'blocks') => {
      const relatedId = direction === 'blocked_by'
        ? String(edge.from_task_id)
        : String(edge.to_task_id);
      const related = taskById.get(relatedId);
      return related ? [{
        relation_id: String(edge.id),
        direction,
        task: {
          id: related.id,
          full_id: related.full_id,
          title: related.title,
          column: related.column as 'backlog' | 'in_progress' | 'review' | 'done',
          is_blocked: related.is_blocked,
        },
      }] : [];
    };

    return NextResponse.json({
      blockers: (edges ?? []).filter((edge) => edge.to_task_id === taskId)
        .flatMap((edge) => mapItem(edge, 'blocked_by')),
      downstream: (edges ?? []).filter((edge) => edge.from_task_id === taskId)
        .flatMap((edge) => mapItem(edge, 'blocks')),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Не удалось загрузить связи' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id: taskId } = await params;
    const context = await getAuthorizedTask(request, taskId);
    if (context.error) return context.error;

    const body = await request.json().catch(() => ({}));
    const relatedTaskId = typeof body?.related_task_id === 'string' ? body.related_task_id : '';
    const direction = body?.direction as TaskRelationDirection;
    if (!relatedTaskId || !['blocked_by', 'blocks'].includes(direction)) {
      return NextResponse.json(
        { error: 'Нужны related_task_id и direction: blocked_by или blocks' },
        { status: 400 },
      );
    }

    const { supabase, task, profileId } = context;
    const worker = await getActiveWorkerInWorkspace(profileId, task.workspace_id);
    if (!worker) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });

    const { data: related, error: relatedError } = await supabase
      .from('tasks')
      .select('id, workspace_id, column, is_blocked, version, updated_at')
      .eq('id', relatedTaskId)
      .eq('workspace_id', task.workspace_id)
      .maybeSingle();
    if (relatedError) return NextResponse.json({ error: relatedError.message }, { status: 500 });
    if (!related) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    if (related.column === 'done') {
      return NextResponse.json({ error: 'Нельзя связать завершённую задачу' }, { status: 409 });
    }

    const fromTaskId = direction === 'blocked_by' ? relatedTaskId : taskId;
    const toTaskId = direction === 'blocked_by' ? taskId : relatedTaskId;
    const anySupabase = supabase as any;
    const { data: relationId, error: createError } = await anySupabase.rpc(
      'create_task_block_relation',
      {
        p_workspace_id: task.workspace_id,
        p_from_task_id: fromTaskId,
        p_to_task_id: toTaskId,
        p_created_by: worker.id,
      },
    );
    if (createError) {
      const duplicate = createError.code === '23505';
      const status = duplicate ? 409 : relationErrorStatus(createError.message);
      return NextResponse.json(
        { error: relationErrorMessage(createError.message, duplicate) },
        { status },
      );
    }

    const { data: affected, error: affectedError } = await supabase
      .from('tasks')
      .select('id, is_blocked, version, updated_at')
      .eq('id', toTaskId)
      .single();
    if (affectedError || !affected) {
      return NextResponse.json(
        { error: affectedError?.message || 'Не удалось получить состояние задачи' },
        { status: 500 },
      );
    }

    try {
      await supabase.channel('flowboard-metrics').send({
        type: 'broadcast',
        event: 'task_changed',
        payload: { workspace_id: task.workspace_id, task_id: toTaskId, relations_changed: true },
      });
    } catch { /* best effort */ }

    return NextResponse.json({ relation_id: relationId, affected_task: affected });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Не удалось создать связь' },
      { status: 500 },
    );
  }
}
