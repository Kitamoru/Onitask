'use server';

/**
 * GET/POST /api/tasks/[id]/comments — task feed & comment creation (AGENT-08).
 *
 * GET: merged feed via RPC `get_task_feed` (migration 076):
 *   task_comments (durable) + task_column_history (durable) + agent_events
 *   (transient 7d). Keyset pagination, newest first.
 *
 * POST: creates a comment in `task_comments`. The author is ALWAYS resolved
 * server-side from Telegram initData (getActiveWorkerInWorkspace) — the
 * client cannot spoof authorship. After insert, broadcasts `comment_created`
 * on the `task-comments-<taskId>` realtime channel (public broadcast — the
 * TWA client has no Supabase JWT, so postgres_changes is not an option).
 *
 * Based on: docs/onitask_flow_.md §22 (updated by ADR-2026-09-06),
 * TASKS.md AGENT-08, migration 076_task_comments.sql.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
  getActiveWorkerInWorkspace,
} from '../../../../../../lib/api-auth';

// ─── GET /api/tasks/[id]/comments — merged feed ──────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { id: taskId } = await params;

    // Tenancy: the task must exist and the profile must be a member of the
    // task's own workspace (resource-scoped, pattern of tasks/[id] PATCH).
    const supabase = createServerClient();
    const { data: taskRow, error: taskFetchError } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();

    if (taskFetchError) {
      return NextResponse.json({ error: taskFetchError.message }, { status: 500 });
    }
    if (!taskRow) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }
    if (!(await isWorkspaceMember(auth.profileId!, taskRow.workspace_id))) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    // Keyset pagination params
    const searchParams = request.nextUrl.searchParams;
    const cursorCreated = searchParams.get('cursor_created');
    const cursorId = searchParams.get('cursor_id');
    const limitParam = Number(searchParams.get('limit') ?? 30);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 30;

    // NOTE: types/supabase.ts is regenerated after migration 076 lands
    // (supabase CLI needs an access token) — cast until then.
    const anySupabase = supabase as any;
    const { data, error } = await anySupabase.rpc('get_task_feed', {
      p_task_id: taskId,
      p_cursor_created: cursorCreated ?? null,
      p_cursor_id: cursorId ?? null,
      p_limit: limit,
    });

    if (error) {
      console.error('[GET /api/tasks/:id/comments] rpc get_task_feed error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data ?? []) as Record<string, unknown>[];
    return NextResponse.json({
      items,
      // Approximation: a full page means more pages are likely available.
      has_more: items.length === limit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── POST /api/tasks/[id]/comments — create comment ──────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth from the CLONE before reading the body (pattern of tasks/[id]).
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { id: taskId } = await params;
    const body = await request.json();

    // Validate text: trim, 1..2000 (DB CHECK mirrors this).
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text.length < 1 || text.length > 2000) {
      return NextResponse.json(
        { error: 'Текст комментария должен быть от 1 до 2000 символов' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Tenancy (same pattern as GET)
    const { data: taskRow, error: taskFetchError } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();

    if (taskFetchError) {
      return NextResponse.json({ error: taskFetchError.message }, { status: 500 });
    }
    if (!taskRow) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }
    const taskWorkspaceId = taskRow.workspace_id as string;

    if (!(await isWorkspaceMember(auth.profileId!, taskWorkspaceId))) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    // Author: resolved server-side ONLY (decision R6). The client cannot
    // pass author_id / author_name — they are ignored even if present.
    const worker = await getActiveWorkerInWorkspace(auth.profileId!, taskWorkspaceId);
    if (!worker) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const { data: workerRow } = await supabase
      .from('workers')
      .select('display_name, type')
      .eq('id', worker.id)
      .maybeSingle();

    const authorName =
      (workerRow?.display_name as string | undefined) ?? auth.displayName ?? 'Участник';

    const { data: inserted, error: insertError } = await supabase
      .from('task_comments')
      .insert({
        workspace_id: taskWorkspaceId,
        task_id: taskId,
        author_id: worker.id,
        author_name: authorName,
        author_type: (workerRow?.type as string | undefined) ?? 'human',
        body: text,
        source: 'twa',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[POST /api/tasks/:id/comments] insert error', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Map the DB row to the feed item shape (get_task_feed 'comment' branch).
    const item = {
      item_id: inserted.id,
      kind: 'comment',
      author_id: inserted.author_id,
      author_name: inserted.author_name,
      author_type: inserted.author_type,
      body: inserted.body,
      created_at: inserted.created_at,
      edited_at: inserted.edited_at ?? null,
      payload: {
        source: inserted.source,
        ref_task_id: inserted.ref_task_id ?? null,
        parent_id: inserted.parent_id ?? null,
      },
    };

    // Best-effort live broadcast to other open tabs (server-side, public
    // channel — same pattern as 'task_changed' on flowboard-metrics).
    try {
      await supabase
        .channel(`task-comments-${taskId}`)
        .send({
          type: 'broadcast',
          event: 'comment_created',
          payload: { item },
        });
    } catch {
      // Broadcast is best-effort
    }

    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
