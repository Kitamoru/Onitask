'use server';

/**
 * POST /api/workspaces/[id]/leave — Current user leaves the board.
 *
 * Soft-deactivates the actor's worker row (is_active = false), consistent
 * with revoke — assignment history is preserved and the worker can be
 * re-invited later.
 *
 * Constraints:
 *   - The workspace owner cannot leave until ownership is transferred
 *     (INV: owner must always exist) → 409 owner_must_transfer_first.
 *   - Agents cannot leave (they are not authenticated actors anyway).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, extractInitData, getActiveWorkerInWorkspace } from '../../../../../../lib/api-auth';
import { createServerClient } from '../../../../../../lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const { id: workspaceId } = await params;
    const supabase = createServerClient();

    // 2. Actor must be an active worker of this workspace
    const actorWorker = await getActiveWorkerInWorkspace(auth.profileId!, workspaceId);
    if (!actorWorker) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // 3. The owner must transfer ownership before leaving
    if (actorWorker.role === 'owner') {
      return NextResponse.json(
        { error: 'owner_must_transfer_first' },
        { status: 409 },
      );
    }

    // 4. Soft-deactivate own worker row
    const { error: updateError } = await supabase
      .from('workers')
      .update({ is_active: false })
      .eq('id', actorWorker.id);

    if (updateError) {
      console.error('leave: update error', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 5. Broadcast for realtime
    try {
      await supabase
        .channel('flowboard-metrics')
        .send({
          type: 'broadcast',
          event: 'task_changed',
          payload: { workspace_id: workspaceId },
        });
    } catch {
      // Best-effort
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('leave: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
