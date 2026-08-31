import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import { DEFAULT_ALLOWED_TOOLS } from '../../../../lib/shared/autonomyLevels';
import { validateTelegramInitData } from '../../../../src/lib/telegram/validate';

// ============================================================================
// Types
// ============================================================================

export interface McpKeyInfo {
  keyHash: string;
  name: string;
  agent_name: string;
  created_at: string;
  expires_at: string;
  prefix: string;
  workspace_id: string;
  workspace_name: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

interface CreateKeyResponse {
  success: boolean;
  keyId?: string;
  plaintextKey?: string;
  prefix?: string;
  name?: string;
  workspace_id?: string;
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sk_${hex}`;
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

  const { data: workers, error: workersError } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', profileId)
    .eq('is_active', true);

  if (workersError) {
    console.error('authenticateAndGetWorkspaces workers error:', workersError);
    return { profileId: '', workspaceIds: [], error: NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    )};
  }

  const workspaceIds = workers?.map((w: { workspace_id: string }) => w.workspace_id).filter(Boolean) ?? [];

  return { profileId, workspaceIds };
}

// ============================================================================
// GET — List MCP keys
// ============================================================================

export async function GET(request: NextRequest) {
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
      return NextResponse.json({ keys: [] });
    }

    const supabase = createServerClient();

    const { data: keysData, error: keysError } = await supabase
      .from('mcp_agent_keys')
      .select('key_hash, agent_name, created_at, expires_at, workspace_id')
      .in('workspace_id', workspaceIds)
      .is('revoked_at', null);

    if (keysError) {
      console.error('GET /api/mcp-keys DB error:', keysError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    const { data: workspaces, error: wsError } = await supabase
      .from('workspaces')
      .select('id, name')
      .in('id', workspaceIds);

    if (wsError) {
      console.error('GET /api/mcp-keys workspace fetch error:', wsError);
    }

    const wsMap: Record<string, string> = {};
    for (const ws of (workspaces ?? [])) {
      wsMap[ws.id] = ws.name;
    }

    const keys: McpKeyInfo[] = (keysData ?? []).map((k) => ({
      keyHash: k.key_hash,
      name: k.agent_name,
      agent_name: k.agent_name,
      created_at: k.created_at ?? new Date().toISOString(),
      expires_at:
        k.expires_at ??
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      prefix: k.key_hash.slice(0, 8),
      workspace_id: k.workspace_id,
      workspace_name: wsMap[k.workspace_id] ?? '',
    }));

    return NextResponse.json({ keys });
  } catch (err) {
    console.error('GET /api/mcp-keys error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ============================================================================
// POST — Create new MCP key
// ============================================================================

export async function POST(request: NextRequest) {
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

    const { profileId, workspaceIds } = authResult;

    // ✅ Только одно объявление body
    const body = await request.json();
    const agentName = (body.agent_name as string) ?? null;
    const workspaceId = (body.workspace_id as string) ?? null;
    const expiresInDays = (body.expires_in_days as number) ?? 90;

    if (!agentName || agentName.trim().length < 1) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'agent_name is required' },
        { status: 400 },
      );
    }
    if (agentName.trim().length > 100) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'agent_name must be 1-100 chars' },
        { status: 400 },
      );
    }
    if (expiresInDays < 1) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'expires_in_days must be positive' },
        { status: 400 },
      );
    }

    const targetWorkspaceId = workspaceId || workspaceIds[0];

    if (!targetWorkspaceId || !workspaceIds.includes(targetWorkspaceId)) {
      return NextResponse.json(
        { error: 'forbidden', message: 'User does not have access to this workspace' },
        { status: 403 },
      );
    }

    const supabase = createServerClient();

    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', profileId)
      .eq('workspace_id', targetWorkspaceId)
      .eq('is_active', true)
      .maybeSingle();

    const plaintextKey = generateApiKey();
    const keyHash = await hashApiKey(plaintextKey);
    const prefix = keyHash.slice(0, 8);

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);

    const { error: insertError } = await supabase
      .from('mcp_agent_keys')
      .insert({
        workspace_id: targetWorkspaceId,
        key_hash: keyHash,
        agent_name: agentName,
        allowed_tools: DEFAULT_ALLOWED_TOOLS,
        can_send_messages: true,
        max_tasks_per_minute: 50,
        created_by: worker?.id ?? null,
        expires_at: expiryDate.toISOString(),
      });

    if (insertError) {
      console.error('POST /api/mcp-keys DB insert error:', insertError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Failed to save key' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      keyId: keyHash,
      plaintextKey,
      prefix,
      agent_name: agentName,
      workspace_id: targetWorkspaceId,
    });
  } catch (err) {
    console.error('POST /api/mcp-keys error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Internal server error' },
      { status: 500 },
    );
  }
}