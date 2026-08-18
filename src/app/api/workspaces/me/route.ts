import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';

/**
 * GET /api/workspaces/me — Returns list of workspaces the authenticated user has access to.
 * Used by MCP Keys page to let user select which workspace the key belongs to.
 */
export async function GET() {
  try {
    const supabase = createServerClient();

    // Get session to identify user
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, error: 'unauthorized' },
        { status: 401 },
      );
    }

    // Get all workspaces the user has access to via workers table
    const { data: workers, error: workersError } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', session.user.id)
      .eq('is_active', true);

    if (workersError) {
      console.error('GET /api/workspaces/me DB error:', workersError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    const workspaceIds = workers?.map((w: { workspace_id: string }) => w.workspace_id).filter(Boolean) ?? [];

    if (workspaceIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { workspaces: [] },
      });
    }

    const { data: workspaces, error: workspacesError } = await supabase
      .from('workspaces')
      .select('id, name, slug, task_prefix')
      .in('id', workspaceIds)
      .order('name');

    if (workspacesError) {
      console.error('GET /api/workspaces/me fetch error:', workspacesError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: { workspaces: workspaces ?? [] },
    });
  } catch (err) {
    console.error('GET /api/workspaces/me unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}