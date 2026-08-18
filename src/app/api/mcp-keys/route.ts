import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';

// ============================================================================
// Types
// ============================================================================

export interface McpKeyConfig {
  allowed_tools: string[] | 'all';
  can_send_messages: boolean;
  max_tasks_per_minute?: number;
  name?: string;
  created_at?: string;
  expires_at?: string;
}

export interface McpKeyInfo {
  keyHash: string;
  name: string;
  created_at: string;
  expires_at: string;
  prefix: string;
  workspace_id: string;
  workspace_name: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a random API key with "sk_" prefix.
 */
function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sk_${hex}`;
}

/**
 * Hash API key using SHA-256 for secure storage/lookup.
 * Returns hex string.
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get first 8 characters of a hex string as key prefix.
 */
function getKeyPrefix(hex: string): string {
  return hex.slice(0, 8);
}

/**
 * Calculate default expiry date (90 days from now).
 */
function getDefaultExpiry(): string {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString();
}

/**
 * Get all workspace IDs the user has access to via workers table.
 */
async function getUserWorkspaceIds(supabase: any): Promise<string[]> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) return [];

  const { data: workers } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', session.user.id)
    .eq('is_active', true);

  return workers?.map((w: { workspace_id: string }) => w.workspace_id).filter(Boolean) ?? [];
}

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

// ============================================================================
// GET — List MCP keys from ALL user's workspaces
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();

    // Get all workspace IDs the user has access to
    const workspaceIds = await getUserWorkspaceIds(supabase);

    if (workspaceIds.length === 0) {
      return NextResponse.json({ keys: [] });
    }

    // Fetch all workspace settings in one query
    const { data: settingsList, error: settingsError } = await supabase
      .from('workspace_settings')
      .select('workspace_id, mcp_api_keys')
      .in('workspace_id', workspaceIds);

    if (settingsError) {
      console.error('GET /api/mcp-keys DB error:', settingsError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    // Fetch all workspace names
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

    // Collect keys from all workspaces
    const keys: McpKeyInfo[] = [];
    for (const settings of (settingsList ?? [])) {
      const mcpApiKeys = ((settings as any)?.mcp_api_keys as Record<string, McpKeyConfig>) ?? {};
      const workspaceName = wsMap[settings.workspace_id] ?? '';
      for (const [keyHash, config] of Object.entries(mcpApiKeys)) {
        keys.push({
          keyHash,
          name: config.name || '',
          created_at: config.created_at || new Date().toISOString(),
          expires_at: config.expires_at || getDefaultExpiry(),
          prefix: getKeyPrefix(keyHash),
          workspace_id: settings.workspace_id,
          workspace_name: workspaceName,
        });
      }
    }

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
    const supabase = createServerClient();

    const body = await request.json();
    const name = (body.name as string) ?? `Ключ ${new Date().toLocaleTimeString('ru-RU')}`;
    const workspaceId = (body.workspace_id as string) ?? null;
    const expiresInDays = (body.expires_in_days as number) ?? 90;

    // Validate name length
    if (name.length > 100) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'Key name too long (max 100 chars)' },
        { status: 400 },
      );
    }

    // If no workspace_id provided, use active workspace
    if (!workspaceId) {
      const activeWs = await getActiveWorkspaceId(supabase);
      if (!activeWs) {
        return NextResponse.json(
          { error: 'unauthorized', message: 'No active workspace' },
          { status: 401 },
        );
      }
    }

    // Validate that user has access to the specified workspace
    const userWorkspaces = await getUserWorkspaceIds(supabase);
    const targetWorkspaceId = workspaceId || userWorkspaces[0];

    if (!targetWorkspaceId || !userWorkspaces.includes(targetWorkspaceId)) {
      return NextResponse.json(
        { error: 'forbidden', message: 'User does not have access to this workspace' },
        { status: 403 },
      );
    }

    // Fetch current settings
    const { data: settingsData, error: fetchError } = await supabase
      .from('workspace_settings')
      .select('mcp_api_keys')
      .eq('workspace_id', targetWorkspaceId)
      .maybeSingle();

    if (fetchError) {
      console.error('POST /api/mcp-keys DB fetch error:', fetchError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    const existingKeys = ((settingsData as any)?.mcp_api_keys as Record<string, McpKeyConfig>) ?? {};

    // Generate new key
    const plaintextKey = generateApiKey();
    const keyHash = await hashApiKey(plaintextKey);
    const prefix = getKeyPrefix(keyHash);

    // Calculate expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);

    // Store key hash with metadata (legacy mode compatible)
    const newKeys: Record<string, McpKeyConfig> = {
      ...existingKeys,
      [keyHash]: {
        allowed_tools: 'all',
        can_send_messages: true,
        max_tasks_per_minute: 50,
        name,
        created_at: new Date().toISOString(),
        expires_at: expiryDate.toISOString(),
      },
    };

    // Update workspace_settings
    const { error: updateError } = await supabase
      .from('workspace_settings')
      .update({ mcp_api_keys: newKeys as any })
      .eq('workspace_id', targetWorkspaceId);

    if (updateError) {
      console.error('POST /api/mcp-keys DB update error:', updateError);
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
      name,
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
