'use server';

/**
 * POST /api/workers/:workerId/revoke — Revoke a worker's access to the board.
 *
 * Soft-deactivates the worker (is_active = false). Only owner/admin of the
 * worker's workspace can perform this action.
 *
 * Constraints:
 *   - Target cannot be the workspace owner (INV: owner must always exist).
 *   - Target cannot be the actor themselves (self-revoke blocked).
 *   - Target must be an active human worker.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, extractInitData, getActiveWorkerInWorkspace } from '../../../../../../lib/api-auth';
import { createServerClient } from '../../../../../../lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workerId: string }> },
) {
  try {
    // 1. Auth
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { workerId } = await params;
    const supabase = createServerClient();

    // 2. Fetch target worker
    const { data: targetWorker, error: fetchError } = await supabase
      .from('workers')
      .select('id, workspace_id, role, type, is_active, display_name')
      .eq('id', workerId)
      .maybeSingle();

    if (fetchError) {
      console.error('revoke: target fetch error', fetchError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    if (!targetWorker) {
      return NextResponse.json({ error: 'Воркер не найден' }, { status: 404 });
    }

    const target = targetWorker as {
      id: string;
      workspace_id: string;
      role: string | null;
      type: string | null;
      is_active: boolean;
      display_name: string;
    };

    // 3. Target must be active
    if (!target.is_active) {
      return NextResponse.json({ error: 'Воркер уже неактивен' }, { status: 400 });
    }

    // 4. Target must be human
    if (target.type !== 'human') {
      return NextResponse.json({ error: 'Нельзя отозвать доступ у AI-агента' }, { status: 400 });
    }

    // 5. Resolve actor in the same workspace
    const actorWorker = await getActiveWorkerInWorkspace(auth.profileId!, target.workspace_id);
    if (!actorWorker) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // 6. Actor must be owner or admin
    if (actorWorker.role !== 'owner' && actorWorker.role !== 'admin') {
      return NextResponse.json({ error: 'Только владелец или администратор может отозвать доступ' }, { status: 403 });
    }

    // 7. Cannot revoke the workspace owner
    if (target.role === 'owner') {
      return NextResponse.json({ error: 'Нельзя отозвать доступ у владельца доски' }, { status: 403 });
    }

    // 8. Cannot revoke self
    if (actorWorker.id === target.id) {
      return NextResponse.json({ error: 'Нельзя отозвать доступ у самого себя' }, { status: 400 });
    }

    // 9. Soft-deactivate
    const { error: updateError } = await supabase
      .from('workers')
      .update({ is_active: false })
      .eq('id', target.id);

    if (updateError) {
      console.error('revoke: update error', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 10. Broadcast for realtime
    try {
      await supabase
        .channel('flowboard-metrics')
        .send({
          type: 'broadcast',
          event: 'task_changed',
          payload: { workspace_id: target.workspace_id },
        });
    } catch {
      // Best-effort
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('revoke: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
