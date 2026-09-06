'use server';

/**
 * POST /api/workspaces/[id]/members — Add or reactivate workers in a workspace.
 *
 * Upserts workers by source_ids:
 *   - If a worker row already exists (UNIQUE workspace_id + source_id), sets is_active = true.
 *   - If no row exists, creates a new worker with role = 'member'.
 *
 * Only owner/admin of the workspace can perform this action.
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
    const body = await request.json();
    const sourceIds = body.source_ids as string[] | undefined;

    if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length === 0) {
      return NextResponse.json(
        { error: 'Необходим массив source_ids' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();
    const profileId = auth.profileId!;

    // 2. Verify actor is owner/admin of this workspace
    const actorWorker = await getActiveWorkerInWorkspace(profileId, workspaceId);
    if (!actorWorker) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    if (actorWorker.role !== 'owner' && actorWorker.role !== 'admin') {
      return NextResponse.json(
        { error: 'Только владелец или администратор может добавлять коллег' },
        { status: 403 },
      );
    }

    // 3. Upsert each worker
    let addedCount = 0;

    for (const sourceId of sourceIds) {
      // Fetch display_name from profiles
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('id', sourceId)
        .maybeSingle();

      const displayName = profileData?.display_name || '';

      // Upsert: if exists → set is_active=true; if not → insert new member
      const { error: upsertError } = await supabase
        .from('workers')
        .upsert(
          {
            workspace_id: workspaceId,
            source_id: sourceId,
            type: 'human',
            role: 'member',
            display_name: displayName,
            is_active: true,
          },
          {
            onConflict: 'workspace_id,source_id',
            ignoreDuplicates: false,
          },
        );

      if (upsertError) {
        console.error('members: upsert error for source_id', sourceId, upsertError);
        continue;
      }

      addedCount++;
    }

    return NextResponse.json({ success: true, added: addedCount });
  } catch (err) {
    console.error('members: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}