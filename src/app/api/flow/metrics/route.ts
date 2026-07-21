'use server';

/**
 * POST /api/flow/metrics — Aggregate flow metrics for FlowBoard.
 *
 * Replaces client-side Supabase queries in src/lib/api/flow.ts getFlowMetrics().
 * Uses Telegram initData validation (server-side, service_role key bypasses RLS).
 * 
 * Response matches FlowMetricsResponse from flowboard types.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../lib/api-auth';
import type { Database } from '../../../../../types/supabase';

type WorkersRow = Database['public']['Tables']['workers']['Row'];
type SprintsRow = Database['public']['Tables']['sprints']['Row'];
type TasksRow = Database['public']['Tables']['tasks']['Row'];

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

    // 1. Find workspace from user's workers
    const { data: workers, error: workersErr } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profileId)
      .eq('is_active', true)
      .limit(1);

    if (workersErr) {
      console.error('metrics: workers error', workersErr);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    const workspaceId = workers?.[0]?.workspace_id;
    if (!workspaceId) {
      // Return empty metrics — user has no workspace yet
      return NextResponse.json({
        success: true,
        data: {
          sprint: null,
          columns: [],
          workers: [],
          alerts: [],
          cached_at: new Date().toISOString(),
          cache_ttl: { columns: 5, workers: 60, alerts: 60 },
        },
      });
    }

    // 2. Sprint info
    const { data: sprintData } = await supabase
      .from('sprints')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'planning'])
      .order('created_at', { ascending: false })
      .limit(1);

    let sprint: any = null;
    if (sprintData && (sprintData as SprintsRow[]).length > 0) {
      const sp = (sprintData as SprintsRow[])[0];
      sprint = {
        id: sp.id,
        name: sp.name || '',
        topic: '',
        startDate: sp.start_date || '',
        endDate: sp.end_date || '',
        daysElapsed: 0,
        totalDays: 7,
        progress: 0,
        doneSP: 0,
        totalSP: sp.capacity ?? 0,
        inProgress: 0,
        onReview: 0,
        isActive: sp.status === 'active',
      };
    }

    // 3. Column health
    const { data: columnCounts } = await supabase
      .from('tasks')
      .select('column')
      .eq('workspace_id', workspaceId)
      .eq('is_inbox', false);

    const columnMap: Record<string, number> = { backlog: 0, in_progress: 0, review: 0, done: 0 };
    ((columnCounts ?? []) as TasksRow[]).forEach((t) => {
      if (t.column in columnMap) {
        columnMap[t.column]++;
      }
    });

    const wipLimits: Record<string, number | null> = {
      backlog: 15, in_progress: 5, review: 4, done: null,
    };

    const columns: any[] = Object.entries(columnMap).map(([name, wip_current]) => {
      const wip_limit = wipLimits[name] ?? null;
      let health: 'green' | 'yellow' | 'red' = 'green';
      if (wip_limit !== null && wip_current > wip_limit) health = 'red';
      else if (wip_limit !== null && wip_current >= wip_limit * 0.8) health = 'yellow';
      return { name, wip_current, wip_limit, health, avg_cycle_time_hours: null };
    });

    if (sprint) {
      sprint.inProgress = columnMap.in_progress;
      sprint.onReview = columnMap.review;
    }

    // 4. Worker load
    const { data: workersData } = await supabase
      .from('workers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    const overloadThreshold = 6;
    const workersMetrics: any[] = ((workersData ?? []) as WorkersRow[]).map((w) => {
      const cognitive_load = w.type === 'human' ? Math.min(3, 1) : 0;
      return {
        display_name: w.display_name || w.id.slice(0, 8),
        type: w.type as 'human' | 'agent',
        cognitive_load,
        overload_threshold: overloadThreshold,
        status: cognitive_load >= 3 ? 'overloaded' : 'ok',
        throughput: w.type === 'agent' ? 1.2 : undefined,
        pending_escalations: undefined,
      };
    });

    // 5. Alerts
    const alerts: any[] = [];
    for (const wm of workersMetrics) {
      if (wm.status === 'overloaded') {
        alerts.push({
          type: 'overloaded_member',
          severity: 'high',
          message: `${wm.display_name} перегружен: ${wm.cognitive_load} / ${wm.overload_threshold}`,
        });
      }
    }
    for (const col of columns) {
      if (col.health === 'red') {
        alerts.push({
          type: 'bottleneck',
          severity: 'high',
          message: `Колонка "${col.name}" перегружена: ${col.wip_current} задач при лимите ${col.wip_limit}`,
          column: col.name,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        sprint,
        columns,
        workers: workersMetrics,
        alerts,
        cached_at: new Date().toISOString(),
        cache_ttl: { columns: 5, workers: 60, alerts: 60 },
      },
    });
  } catch (err) {
    console.error('metrics: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}