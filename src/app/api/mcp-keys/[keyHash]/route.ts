import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import {
  isAutonomyLevel,
  isPlaybookVariant,
  allowedToolsForLevel,
} from '../../../../../lib/shared/dutyPlaybook';
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

// ============================================================================
// PATCH /api/mcp-keys/[keyHash] — Change autonomy level of an active key.
// Mirrors creation-time enforcement: observer → read-only allowed_tools,
// tasks/full → all. Both fields are updated atomically in one UPDATE.
// ============================================================================

export async function PATCH(
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

    if (workspaceIds.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Key not found' },
        { status: 404 },
      );
    }

    const body = await request.json();
    const rawLevel = (body.autonomy_level as string) ?? '';
    if (!isAutonomyLevel(rawLevel)) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'autonomy_level must be observer, tasks or full' },
        { status: 400 },
      );
    }

    // Playbook variant (migration 057) — optional on PATCH; only sent when
    // the user explicitly picked a different depth.
    const rawVariant = (body.playbook_variant as string | undefined) ?? undefined;
    if (rawVariant !== undefined && !isPlaybookVariant(rawVariant)) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'playbook_variant must be high or lite' },
        { status: 400 },
      );
    }

    const { keyHash } = await params;

    const supabase = createServerClient();

    // Update only keys belonging to the user's workspaces (same scope as DELETE)
    const { data, error } = await supabase
      .from('mcp_agent_keys')
      .update({
        autonomy_level: rawLevel,
        allowed_tools: allowedToolsForLevel(rawLevel),
        ...(rawVariant !== undefined ? { playbook_variant: rawVariant } : {}),
      })
      .eq('key_hash', keyHash)
      .in('workspace_id', workspaceIds)
      .is('revoked_at', null)
      .select('id');

    if (error) {
      console.error('PATCH /api/mcp-keys DB update error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Key not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, autonomy_level: rawLevel });
  } catch (err) {
    console.error('PATCH /api/mcp-keys error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/mcp-keys/[keyHash] — Soft revoke an MCP key by its hash.
 * Row is kept for agent_events history (contract v0.8.0 §2.3).
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

    if (workspaceIds.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Key not found' },
        { status: 404 },
      );
    }

    const { keyHash } = await params;

    const supabase = createServerClient();

    // Soft revoke: only keys belonging to the user's workspaces
    const { data, error } = await supabase
      .from('mcp_agent_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('key_hash', keyHash)
      .in('workspace_id', workspaceIds)
      .is('revoked_at', null)
      .select('id');

    if (error) {
      console.error('DELETE /api/mcp-keys DB revoke error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Key not found' },
        { status: 404 },
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