'use server';

/**
 * GET /api/workspaces/[id]/settings — Returns workspace settings and links.
 *
 * Single source of truth for workspace settings (INV-08).
 * Used by Board Edit Page to load existing configuration.
 *
 * Response:
 *   workspace_settings: workspace_settings row (jsonb fields included)
 *   workspace_links: external links rows for this workspace
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../../lib/api-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;
    const workspaceId = (await params).id;

    // Authenticate via Telegram initData
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();

    // Verify user has access to this workspace
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_id', auth.profileId!)
      .maybeSingle();

    if (workerError) {
      console.error('workspace-settings: worker query error', workerError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    if (!workerData) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // 1. Get workspace_settings
    const { data: settingsData, error: settingsError } = await supabase
      .from('workspace_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (settingsError) {
      console.error('workspace-settings: settings query error', settingsError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    // 2. Get workspace_links
    const { data: linksData, error: linksError } = await supabase
      .from('workspace_links')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (linksError) {
      console.error('workspace-settings: links query error', linksError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        workspace_settings: settingsData,
        workspace_links: linksData ?? [],
      },
    });
  } catch (err) {
    console.error('workspace-settings: unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}