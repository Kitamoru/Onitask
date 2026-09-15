'use server';

/**
 * POST /api/workspaces/board-counts — lightweight per-board aggregates for /boards.
 *
 * BOARD-AGG: карточки «Стола» — производная read-модель, а не пересчёт сырых задач
 * на клиенте. Возвращает counts по колонкам per workspace, riskData (people/
 * processes/escalations), состав команд и активные спринты — константный payload
 * независимо от числа задач. Пересчёт: при мутациях задач клиент инвалидирует
 * queryKey ['board-counts'] (React Query), плюс страховочный refetch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { buildSprintsByWorkspace } from '../../../../lib/sprintSummary';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;

    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();
    const profileId = auth.profileId!;

    const { data: userWorkersData, error: userWorkersError } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profileId)
      .eq('is_active', true);

    if (userWorkersError) {
      console.error('board-counts: user workers query error', userWorkersError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    const workspaceIds = (userWorkersData || [])
      .map((w: { workspace_id: string | null }) => w.workspace_id)
      .filter((id: string | null | undefined): id is string => Boolean(id));

    if (workspaceIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          counts: {},
          members: {},
          riskData: { people: 0, processes: 0, escalations: 0 },
          sprintsByWorkspace: {},
        },
      });
    }

    const [taskResult, memberResult, sprintResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('workspace_id, column, assigned_to, escalation_reason')
        .in('workspace_id', workspaceIds),
      supabase
        .from('workers')
        .select('workspace_id, type')
        .in('workspace_id', workspaceIds)
        .eq('is_active', true),
      supabase
        .from('sprints')
        .select('workspace_id, name, goal, status, start_date, end_date')
        .in('workspace_id', workspaceIds)
        .in('status', ['active', 'planning'])
        .order('created_at', { ascending: false }),
    ]);

    if (taskResult.error) {
      console.error('board-counts: tasks query error', taskResult.error);
    }
    if (memberResult.error) {
      console.error('board-counts: members query error', memberResult.error);
    }
    if (sprintResult.error) {
      console.error('board-counts: sprints query error', sprintResult.error);
    }

    type TaskAggRow = {
      workspace_id: string | null;
      column: string | null;
      assigned_to: string | null;
      escalation_reason: string | null;
    };

    const zeroStats = () => ({ inQueue: 0, inWork: 0, onReview: 0, done: 0 });
    const counts: Record<string, { inQueue: number; inWork: number; onReview: number; done: number }> = {};
    for (const wsId of workspaceIds) counts[wsId] = zeroStats();

    const peopleSet = new Set<string>();
    let processes = 0;
    let escalations = 0;

    for (const t of (taskResult.data || []) as TaskAggRow[]) {
      if (!t.workspace_id || !counts[t.workspace_id]) continue;
      // Только 4 канонические колонки — как в клиентском пересчёте ранее.
      if (t.column === 'backlog') counts[t.workspace_id].inQueue++;
      else if (t.column === 'in_progress') counts[t.workspace_id].inWork++;
      else if (t.column === 'review') counts[t.workspace_id].onReview++;
      else if (t.column === 'done') counts[t.workspace_id].done++;

      if (t.assigned_to) peopleSet.add(t.assigned_to);
      if (t.column === 'in_progress') processes++;
      if (t.escalation_reason) escalations++;
    }

    type MemberRow = { workspace_id: string | null; type: string | null };
    const members: Record<string, { humans: number; agents: number }> = {};
    for (const wsId of workspaceIds) members[wsId] = { humans: 0, agents: 0 };
    for (const w of (memberResult.data || []) as MemberRow[]) {
      if (!w.workspace_id || !members[w.workspace_id]) continue;
      if (w.type === 'agent') members[w.workspace_id].agents++;
      else members[w.workspace_id].humans++;
    }

    return NextResponse.json({
      success: true,
      data: {
        counts,
        members,
        riskData: { people: peopleSet.size, processes, escalations },
        sprintsByWorkspace: buildSprintsByWorkspace(sprintResult.data || []),
      },
    });
  } catch (err) {
    console.error('board-counts: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
