import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';

/**
 * Get the active workspace ID for the current user.
 * Uses the profiles.active_workspace_id field.
 */
async function getActiveWorkspaceId(supabase: any): Promise<string | null> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_workspace_id')
    .eq('id', session.user.id)
    .maybeSingle();

  return profile?.active_workspace_id ?? null;
}

/**
 * DELETE /api/mcp-keys/[keyHash] — Remove an MCP key by its hash.
 */

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> },
) {
  try {
    const supabase = createServerClient();

    // Get workspace_id from query params OR from auth context
    let workspaceId: string | null = request.url.split('workspace_id=')[1]?.split('&')[0] ?? null;

    if (!workspaceId) {
      workspaceId = await getActiveWorkspaceId(supabase);
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'No active workspace' },
        { status: 401 },
      );
    }

    const { keyHash } = await params;

    // Fetch current settings
    const { data: settingsData, error: fetchError } = await supabase
      .from('workspace_settings')
      .select('mcp_api_keys')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (fetchError) {
      console.error('DELETE /api/mcp-keys DB fetch error:', fetchError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    const existingKeys = ((settingsData as any)?.mcp_api_keys as Record<string, unknown>) ?? {};

    // Check if key exists
    if (!existingKeys[keyHash]) {
      return NextResponse.json(
        { error: 'not_found', message: 'Key not found' },
        { status: 404 },
      );
    }

    // Delete the key
    delete existingKeys[keyHash];

    // Update workspace_settings
    const { error: updateError } = await supabase
      .from('workspace_settings')
      .update({ mcp_api_keys: existingKeys as any })
      .eq('workspace_id', workspaceId);

    if (updateError) {
      console.error('DELETE /api/mcp-keys DB update error:', updateError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Failed to delete key' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/mcp-keys error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Internal server error' },
      { status: 500 },
    );
  }
}