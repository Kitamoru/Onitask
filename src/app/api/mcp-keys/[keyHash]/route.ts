import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import { validateTelegramInitData } from '../../../../../src/lib/telegram/validate';

/**
 * Authenticate via Telegram initData and return profileId + workspace IDs.
 */
async function authenticateAndGetWorkspaces(initData: string): Promise<{
  profileId: string;
  workspaceIds: string[];
  error?: NextResponse;
}> {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!TELEGRAM_BOT_TOKEN) {
    return { profileId: '', workspaceIds: [], error: NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    )};
  }

  const validation = validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
  if (!validation.valid || !validation.user) {
    return { profileId: '', workspaceIds: [], error: NextResponse.json(
      { success: false, error: validation.error || 'invalid_init_data' },
      { status: 401 },
    )};
  }

  const supabase = createServerClient();

  // Find profile by telegram_id
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_id', Number(validation.user.id))
    .maybeSingle();

  if (!profileData) {
    return { profileId: '', workspaceIds: [], error: NextResponse.json(
      { success: false, error: 'profile_not_found' },
      { status: 404 },
    )};
  }

  const profileId = profileData.id as string;

  // Get all workspaces the user has access to via workers table
  const { data: workers } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', profileId)
    .eq('is_active', true);

  const workspaceIds = workers?.map((w: { workspace_id: string }) => w.workspace_id).filter(Boolean) ?? [];

  return { profileId, workspaceIds };
}

/**
 * DELETE /api/mcp-keys/[keyHash] — Remove an MCP key by its hash.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> },
) {
  try {
    const { searchParams } = new URL(request.url);
    const init_data = searchParams.get('init_data') as string | null;

    if (!init_data) {
      return NextResponse.json(
        { error: 'missing_init_data' },
        { status: 400 },
      );
    }

    const authResult = await authenticateAndGetWorkspaces(init_data);
    if (authResult.error) return authResult.error;

    const { workspaceIds } = authResult;

    const { keyHash } = await params;

    const supabase = createServerClient();

    // Fetch settings from all user's workspaces
    const { data: settingsList, error: fetchError } = await supabase
      .from('workspace_settings')
      .select('workspace_id, mcp_api_keys')
      .in('workspace_id', workspaceIds);

    if (fetchError) {
      console.error('DELETE /api/mcp-keys DB fetch error:', fetchError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    // Find the key in any of the user's workspaces
    let foundWorkspaceId: string | null = null;
    const updatedSettingsList: Array<{ workspace_id: string; mcp_api_keys: Record<string, unknown> }> = [];

    for (const settings of (settingsList ?? [])) {
      const mcpApiKeys = ((settings as any)?.mcp_api_keys as Record<string, unknown>) ?? {};
      if (mcpApiKeys[keyHash]) {
        foundWorkspaceId = settings.workspace_id;
        // Delete the key
        const { [keyHash]: _, ...rest } = mcpApiKeys;
        updatedSettingsList.push({ workspace_id: settings.workspace_id, mcp_api_keys: rest as Record<string, unknown> });
      } else {
        updatedSettingsList.push({ workspace_id: settings.workspace_id, mcp_api_keys: mcpApiKeys });
      }
    }

    if (!foundWorkspaceId) {
      return NextResponse.json(
        { error: 'not_found', message: 'Key not found' },
        { status: 404 },
      );
    }

    // Update each workspace's settings
    for (const updated of updatedSettingsList) {
      const { error: updateError } = await supabase
        .from('workspace_settings')
        .update({ mcp_api_keys: updated.mcp_api_keys as any })
        .eq('workspace_id', updated.workspace_id);

      if (updateError) {
        console.error('DELETE /api/mcp-keys DB update error:', updateError);
      }
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