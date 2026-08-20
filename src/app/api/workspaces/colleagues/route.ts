'use server';

/**
 * GET /api/workspaces/colleagues — Get deduplicated list of colleagues from owner-workspaces.
 *
 * Returns all human workers from workspaces where the authenticated user is owner.
 * Excludes the current user. Deduplicates by source_id (one colleague may be in multiple boards).
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

    // 2. Find workspace IDs where this user is owner
    const { data: ownerWorkers, error: ownerError } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profileId)
      .eq('role', 'owner')
      .eq('is_active', true);

    if (ownerError) {
      console.error('colleagues: owner query error', ownerError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    const workspaceIds = (ownerWorkers || []).map((w: any) => w.workspace_id);

    if (workspaceIds.length === 0) {
      // No owner workspaces — no colleagues to show
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // 3. Find all active human workers in those workspaces, excluding self
    //    Deduplicate by source_id using DISTINCT ON
    const { data: colleagues, error: collError } = await supabase
      .from('workers')
      .select('source_id, display_name')
      .in('workspace_id', workspaceIds)
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

    // 4. Deduplicate by source_id (keep first occurrence per person)
    const seen = new Set<string>();
    const uniqueColleagues: Array<{ source_id: string; display_name: string }> = [];
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