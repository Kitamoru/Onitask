'use server';

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
} from '../../../../../lib/api-auth';
import { escalationReasonLabel, escalationSummary } from '@/lib/escalations';
import type { EscalationQueueItem } from '@/types/escalations';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const scope = request.nextUrl.searchParams.get('scope');
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (scope !== 'all' && !requestedWorkspaceId) {
      return NextResponse.json({ error: 'Не указана рабочая область' }, { status: 400 });
    }

    const supabase = createServerClient();
    const anySupabase = supabase as any;
    const { data: memberRows, error: memberError } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', auth.profileId!)
      .eq('is_active', true);
    if (memberError) return NextResponse.json({ error: 'Не удалось загрузить эскалации' }, { status: 500 });
    const memberWorkspaceIds = [...new Set((memberRows ?? []).map((row: { workspace_id: string }) => row.workspace_id))];
    const workspaceIds = scope === 'all'
      ? memberWorkspaceIds
      : requestedWorkspaceId && memberWorkspaceIds.includes(requestedWorkspaceId)
        ? [requestedWorkspaceId]
        : [];
    if (workspaceIds.length === 0) {
      return NextResponse.json({ error: 'Рабочая область не найдена' }, { status: 404 });
    }

    const [queueResult, workspaceResult] = await Promise.all([
      anySupabase
        .from('pending_escalations')
        .select('id, title, escalation_reason, workspace_id, assigned_agent, moved_to_column_at, hours_pending')
        .in('workspace_id', workspaceIds)
        .order('moved_to_column_at', { ascending: true }),
      supabase
        .from('workspaces')
        .select('id, name, task_prefix')
        .in('id', workspaceIds),
    ]);

    if (queueResult.error) {
      console.error('escalations: queue query error', queueResult.error);
      return NextResponse.json({ error: 'Не удалось загрузить эскалации' }, { status: 500 });
    }
    if (workspaceResult.error) {
      return NextResponse.json({ error: 'Не удалось загрузить эскалации' }, { status: 500 });
    }

    const rows = (queueResult.data ?? []) as Array<{
      id: string;
      title: string;
      escalation_reason: string | null;
      assigned_agent: string | null;
      moved_to_column_at: string | null;
      hours_pending: number | string | null;
    }>;
    const taskIds = rows.map((row) => row.id);
    const { data: taskRows, error: taskError } = taskIds.length
      ? await anySupabase
          .from('tasks')
          .select('id, workspace_id, task_number, metadata, column, is_blocked, assigned_to, active_claim_id')
          .in('workspace_id', workspaceIds)
          .in('id', taskIds)
      : { data: [], error: null };

    if (taskError) {
      console.error('escalations: task enrichment error', taskError);
      return NextResponse.json({ error: 'Не удалось загрузить эскалации' }, { status: 500 });
    }

    const tasksById = new Map(
      ((taskRows ?? []) as Array<{
        id: string;
        workspace_id: string;
        task_number: number;
        metadata: Record<string, unknown> | null;
        column: string;
        is_blocked: boolean;
        assigned_to: string | null;
        active_claim_id: string | null;
      }>).map((task) => [task.id, task]),
    );
    const assignedIdsByWorkspace = new Map<string, string[]>();
    for (const task of (taskRows ?? []) as Array<{ workspace_id: string; assigned_to: string | null }>) {
      if (!task.assigned_to) continue;
      const ids = assignedIdsByWorkspace.get(task.workspace_id) ?? [];
      ids.push(task.assigned_to);
      assignedIdsByWorkspace.set(task.workspace_id, ids);
    }
    const assignedIds = [...new Set([...assignedIdsByWorkspace.values()].flat())];
    const { data: activeAgentRows } = assignedIds.length
      ? await supabase
          .from('workers')
          .select('id')
          .in('id', assignedIds)
          .eq('type', 'agent')
          .eq('is_active', true)
          .like('source_id', 'agent::%')
      : { data: [] };
    const activeAgentIds = new Set(
      ((activeAgentRows ?? []) as Array<{ id: string }>).map((worker) => worker.id),
    );

    const prefixByWorkspace = new Map(
      ((workspaceResult.data ?? []) as Array<{ id: string; name: string; task_prefix: string }>)
        .map((workspace) => [workspace.id, { name: workspace.name || workspace.task_prefix || 'Доска', prefix: workspace.task_prefix || 'TASK' }]),
    );
    const items: EscalationQueueItem[] = rows.flatMap((row) => {
      const task = tasksById.get(row.id);
      if (!task) return [];
      const metadata = task.metadata ?? {};
      const reason = row.escalation_reason;
      return [{
        id: row.id,
        workspace_id: task.workspace_id,
        workspace_name: prefixByWorkspace.get(task.workspace_id)?.name || 'Доска',
        full_id: `${prefixByWorkspace.get(task.workspace_id)?.prefix || 'TASK'}-${task.task_number}`,
        title: row.title,
        agent_name: row.assigned_agent,
        reason,
        reason_label: escalationReasonLabel(reason),
        summary: escalationSummary(reason),
        suggested_action: typeof metadata.suggested_action === 'string'
          ? metadata.suggested_action
          : null,
        nack_reason: typeof metadata.nack_reason === 'string' ? metadata.nack_reason : null,
        nack_detail: typeof metadata.nack_detail === 'string' ? metadata.nack_detail : null,
        moved_to_column_at: row.moved_to_column_at,
        hours_pending: Number(row.hours_pending ?? 0),
        column: task.column,
        is_blocked: task.is_blocked,
        can_retry: task.column !== 'done'
          && !task.is_blocked
          && task.active_claim_id === null
          && Boolean(task.assigned_to && activeAgentIds.has(task.assigned_to)),
      }];
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error('escalations: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Не удалось загрузить эскалации' },
      { status: 500 },
    );
  }
}
