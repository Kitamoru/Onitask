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
    const anySupabase = supabase as any;
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

    const [taskResult, memberResult, sprintResult, settingsResult, reviewResult, stuckResult, orphanResult, escalationResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('workspace_id, column, assigned_to, reviewer_id, cognitive_weight, is_inbox')
        .in('workspace_id', workspaceIds),
      supabase
        .from('workers')
        .select('id, workspace_id, type')
        .in('workspace_id', workspaceIds)
        .eq('is_active', true),
      supabase
        .from('sprints')
        .select('workspace_id, name, goal, status, start_date, end_date')
        .in('workspace_id', workspaceIds)
        .in('status', ['active', 'planning'])
        .order('created_at', { ascending: false }),
      supabase
        .from('workspace_settings')
        .select('workspace_id, enable_cognitive_budget')
        .in('workspace_id', workspaceIds),
      anySupabase.from('review_backlog').select('workspace_id, reviewer_id, review_count').in('workspace_id', workspaceIds),
      anySupabase.from('stuck_tasks').select('workspace_id, id, title, assigned_to').in('workspace_id', workspaceIds),
      anySupabase.from('orphan_blockers').select('workspace_id, id, title, hours_blocked').in('workspace_id', workspaceIds),
      anySupabase.from('pending_escalations').select('workspace_id, id, title, escalation_reason').in('workspace_id', workspaceIds),
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
      reviewer_id: string | null;
      cognitive_weight: number | null;
      is_inbox: boolean;
    };
    type MemberRow = { id: string | null; workspace_id: string | null; type: string | null };

    const zeroStats = () => ({ inQueue: 0, inWork: 0, onReview: 0, done: 0 });
    const counts: Record<string, { inQueue: number; inWork: number; onReview: number; done: number }> = {};
    for (const wsId of workspaceIds) counts[wsId] = zeroStats();

    const peopleByWorkspace = new Map<string, Set<string>>();
    const processByWorkspace = new Map<string, number>();
    const reviewReviewersByWorkspace = new Map<string, Set<string>>();
    const escalationByWorkspace = new Map<string, number>();
    const cognitiveBudgetEnabled = new Map<string, boolean>(
      ((settingsResult.data || []) as Array<{ workspace_id: string; enable_cognitive_budget: boolean | null }>)
        .map((row) => [row.workspace_id, row.enable_cognitive_budget !== false]),
    );
    const humanWorkers = (memberResult.data || []) as MemberRow[];

    for (const t of (taskResult.data || []) as TaskAggRow[]) {
      if (!t.workspace_id || !counts[t.workspace_id]) continue;
      if (t.column === 'backlog') counts[t.workspace_id].inQueue++;
      else if (t.column === 'in_progress') counts[t.workspace_id].inWork++;
      else if (t.column === 'review') counts[t.workspace_id].onReview++;
      else if (t.column === 'done') counts[t.workspace_id].done++;
    }

    for (const row of reviewResult.data || []) {
      const workspaceId = (row as { workspace_id: string }).workspace_id;
      const reviewerId = (row as { reviewer_id: string | null }).reviewer_id;
      if (!workspaceId || !reviewerId) continue;
      const reviewers = reviewReviewersByWorkspace.get(workspaceId) ?? new Set<string>();
      reviewers.add(reviewerId);
      reviewReviewersByWorkspace.set(workspaceId, reviewers);
    }
    for (const workspaceId of workspaceIds) {
      processByWorkspace.set(workspaceId, (processByWorkspace.get(workspaceId) ?? 0) + (reviewReviewersByWorkspace.get(workspaceId)?.size ?? 0));
    }
    for (const row of stuckResult.data || []) {
      const workspaceId = (row as { workspace_id: string }).workspace_id;
      if (workspaceId) processByWorkspace.set(workspaceId, (processByWorkspace.get(workspaceId) ?? 0) + 1);
    }
    for (const row of orphanResult.data || []) {
      const workspaceId = (row as { workspace_id: string }).workspace_id;
      if (workspaceId) processByWorkspace.set(workspaceId, (processByWorkspace.get(workspaceId) ?? 0) + 1);
    }
    for (const row of escalationResult.data || []) {
      const workspaceId = (row as { workspace_id: string }).workspace_id;
      if (workspaceId) escalationByWorkspace.set(workspaceId, (escalationByWorkspace.get(workspaceId) ?? 0) + 1);
    }

    const cognitiveLoadByWorker = new Map<string, number>();
    for (const task of (taskResult.data || []) as TaskAggRow[]) {
      if (task.is_inbox) continue;
      if (task.column === 'in_progress' && task.assigned_to) {
        cognitiveLoadByWorker.set(task.assigned_to, (cognitiveLoadByWorker.get(task.assigned_to) ?? 0) + Math.max(0, Number(task.cognitive_weight ?? 0)));
      }
      if (task.column === 'review' && task.reviewer_id) {
        cognitiveLoadByWorker.set(task.reviewer_id, (cognitiveLoadByWorker.get(task.reviewer_id) ?? 0) + Math.max(0, Number(task.cognitive_weight ?? 0)));
      }
    }
    for (const worker of humanWorkers) {
      if (worker.type !== 'human' || !worker.workspace_id || !worker.id) continue;
      if (cognitiveBudgetEnabled.get(worker.workspace_id) === false) continue;
      if ((cognitiveLoadByWorker.get(worker.id) ?? 0) >= 3) {
        const set = peopleByWorkspace.get(worker.workspace_id) ?? new Set<string>();
        set.add(worker.id);
        peopleByWorkspace.set(worker.workspace_id, set);
      }
    }

    const riskPeople = new Set<string>();
    let riskProcesses = 0;
    let riskEscalations = 0;
    for (const workspaceId of workspaceIds) {
      for (const workerId of peopleByWorkspace.get(workspaceId) ?? []) riskPeople.add(`${workspaceId}:${workerId}`);
      riskProcesses += processByWorkspace.get(workspaceId) ?? 0;
      riskEscalations += escalationByWorkspace.get(workspaceId) ?? 0;
    }
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
        riskData: { people: riskPeople.size, processes: riskProcesses, escalations: riskEscalations },
        sprintsByWorkspace: buildSprintsByWorkspace(sprintResult.data || []),
      },
    });
  } catch (err) {
    console.error('board-counts: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
