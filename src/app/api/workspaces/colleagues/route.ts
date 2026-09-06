'use server';

/**
 * GET /api/workspaces/colleagues — Get deduplicated list of colleagues from owner-workspaces.
 *
 * Returns all human workers from workspaces where the authenticated user is owner.
 * Excludes the current user. Deduplicates by source_id (one colleague may be in multiple boards).
 *
 * Optional query param `workspace_id` — when provided, also returns workers who were
 * previously removed from that workspace (is_active = false), so the edit form can
 * show deleted colleagues for re-invitation.
 *
 * Response: { success: true, data: [{ source_id, display_name }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { createServerClient } from '../../../../../lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const initData = url.searchParams.get('init_data') || undefined;
    const targetWorkspaceId = url.searchParams.get('workspace_id') || undefined;

    // 1. Authenticate
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();
    const profileId = auth.profileId!;

    console.log('colleagues API: profileId =', profileId, 'targetWorkspaceId =', targetWorkspaceId);

    // 2. Find workspace IDs where this user is owner
    //    Use JOIN with profiles to match by telegram_id instead of source_id
    const { data: ownerWorkers, error: ownerError } = await supabase
      .from('workers')
      .select('workspace_id, source_id')
      .eq('role', 'owner')
      .eq('is_active', true)
      .eq('type', 'human');

    if (ownerError) {
      console.error('colleagues: owner query error', ownerError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    console.log('colleagues API: ownerWorkers count =', ownerWorkers?.length);

    // Filter to only those where source_id matches the current user's profileId
    const myWorkspaceIds = (ownerWorkers || [])
      .filter((w: any) => w.source_id === profileId)
      .map((w: any) => w.workspace_id);

    console.log('colleagues API: myWorkspaceIds =', myWorkspaceIds);

    if (myWorkspaceIds.length === 0) {
      // No owner workspaces — no colleagues to show
      console.log('colleagues API: no owner workspaces found');
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // 3. Find all active human workers in those workspaces, excluding self
    const { data: colleagues, error: collError } = await supabase
      .from('workers')
      .select('source_id, display_name')
      .in('workspace_id', myWorkspaceIds)
      .eq('type', 'human')
      .eq('is_active', true)
      .neq('source_id', profileId);

    if (collError) {
      console.error('colleagues: workers query error', collError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    // 4. If targetWorkspaceId is provided, also fetch deleted workers from that workspace
    let deletedColleagues: Array<{ source_id: string; display_name: string }> = [];
    if (targetWorkspaceId) {
      const { data: deleted, error: delError } = await supabase
        .from('workers')
        .select('source_id, display_name')
        .eq('workspace_id', targetWorkspaceId)
        .eq('type', 'human')
        .eq('is_active', false)
        .neq('source_id', profileId);

      if (delError) {
        console.error('colleagues: deleted workers query error', delError);
      } else {
        deletedColleagues = (deleted || []).map((d: any) => ({
          source_id: d.source_id,
          display_name: d.display_name || '',
        }));
      }
    }

    // 5. Deduplicate by source_id (keep first occurrence per person)
    const seen = new Set<string>();
    const uniqueColleagues: Array<{ source_id: string; display_name: string }> = [];

    // First add active colleagues
    for (const c of (colleagues || [])) {
      const sid = (c as any).source_id;
      if (!seen.has(sid)) {
        seen.add(sid);
        uniqueColleagues.push({
          source_id: sid,
          display_name: (c as any).display_name || '',
        });
      }
    }

    // Then add deleted colleagues (only if not already present)
    for (const c of deletedColleagues) {
      const sid = c.source_id;
      if (!seen.has(sid)) {
        seen.add(sid);
        uniqueColleagues.push(c);
      }
    }

    return NextResponse.json({
      success: true,
      data: uniqueColleagues,
    });
  } catch (err) {
    console.error('colleagues: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}