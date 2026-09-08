'use server';

/**
 * POST /api/workspaces/[id]/transfer-ownership — Transfer board ownership
 * to another active human member.
 *
 * Only the current workspace owner can perform this action. The transfer is
 * atomic (RPC `transfer_workspace_ownership`): current owner → admin,
 * target → owner, `workspaces.owner_id` kept in sync. DB-level invariant:
 * at most one owner per workspace (uq_one_owner_per_workspace, migration 080).
 *
 * Constraints:
 *   - Target must be an active human worker of this workspace.
 *   - Target cannot be the actor themselves.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, extractInitData, getActiveWorkerInWorkspace } from '../../../../../../lib/api-auth';
import { createServerClient } from '../../../../../../lib/supabase';

const RPC_ERROR_MESSAGES: Record<string, string> = {
  owner_not_found: 'Владелец доски не найден',
  target_not_in_workspace: 'Участник не найден на этой доске',
  target_not_active_human: 'Передать владение можно только активному участнику-человеку',
  target_already_owner: 'Этот участник уже владелец доски',
  cannot_transfer_to_self: 'Нельзя передать владение самому себе',
};

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
    const body = await request.json();
    const toWorkerId = body.to_worker_id as string | undefined;

    if (!toWorkerId) {
      return NextResponse.json({ error: 'missing_to_worker_id' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 2. Actor must be an active worker of this workspace
    const actorWorker = await getActiveWorkerInWorkspace(auth.profileId!, workspaceId);
    if (!actorWorker) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    // 3. Only the owner can transfer ownership (admin cannot)
    if (actorWorker.role !== 'owner') {
      return NextResponse.json(
        { error: 'Только владелец доски может передать владение' },
        { status: 403 },
      );
    }

    // 4. Validate target: active human worker of this workspace, not the actor
    const { data: targetWorker, error: fetchError } = await supabase
      .from('workers')
      .select('id, workspace_id, role, type, is_active')
      .eq('id', toWorkerId)
      .maybeSingle();

    if (fetchError) {
      console.error('transfer-ownership: target fetch error', fetchError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    if (!targetWorker) {
      return NextResponse.json({ error: 'Участник не найден' }, { status: 404 });
    }

    const target = targetWorker as {
      id: string;
      workspace_id: string;
      role: string | null;
      type: string | null;
      is_active: boolean;
    };

    if (target.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Участник не найден на этой доске' }, { status: 400 });
    }
    if (target.id === actorWorker.id) {
      return NextResponse.json({ error: 'Нельзя передать владение самому себе' }, { status: 400 });
    }
    if (target.type !== 'human' || !target.is_active) {
      return NextResponse.json(
        { error: 'Передать владение можно только активному участнику-человеку' },
        { status: 400 },
      );
    }

    // 5. Atomic transfer via RPC (service role).
    // anySupabase: generated RPC types don't include migration 080 yet
    // (same pattern as DELETE /api/workspaces).
    const anySupabase = supabase as any;
    const { error: rpcError } = await anySupabase.rpc('transfer_workspace_ownership', {
      p_workspace_id: workspaceId,
      p_to_worker_id: toWorkerId,
    });

    if (rpcError) {
      console.error('transfer-ownership: rpc error', rpcError);
      const message =
        RPC_ERROR_MESSAGES[rpcError.message] ?? 'Не удалось передать владение доской';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // 6. Broadcast for realtime
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
    console.error('transfer-ownership: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
