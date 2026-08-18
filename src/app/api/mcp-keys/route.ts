import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';

// ============================================================================
// Types
// ============================================================================

interface McpKeyConfig {
  allowed_tools: string[] | 'all';
  can_send_messages: boolean;
  max_tasks_per_minute?: number;
  name?: string;
  created_at?: string;
  expires_at?: string;
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
 * Get the active workspace ID for the current user.
 * Uses the profiles.active_workspace_id field.
 */
async function getActiveWorkspaceId(supabase: any): Promise<string | null> {
  // Try to get from session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) return null;

  // Get profile's active workspace
  const { data: profile } = await supabase
    .from('profiles')
    .select('active_workspace_id')
    .eq('id', session.user.id)
    .maybeSingle();

  return profile?.active_workspace_id ?? null;
}

// ============================================================================
// GET — List MCP keys (hashes only, no plaintext)
// ============================================================================

export async function GET(request: NextRequest) {
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

    // Fetch workspace settings
    const { data: settingsData, error: settingsError } = await supabase
      .from('workspace_settings')
      .select('mcp_api_keys')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (settingsError) {
      console.error('GET /api/mcp-keys DB error:', settingsError);
      return NextResponse.json(
        { error: 'internal_error', message: 'Database error' },
        { status: 500 },
      );
    }

    // Fetch workspace name
    const { data: workspaceData, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', workspaceId)
      .maybeSingle();

    if (workspaceError) {
      console.error('GET /api/mcp-keys workspace fetch error:', workspaceError);
    }

    const mcpApiKeys = ((settingsData as any)?.mcp_api_keys as Record<string, McpKeyConfig>) ?? {};
    const keys = Object.entries(mcpApiKeys).map(([keyHash, config]) => ({
      keyHash,
      name: config.name || '',
      created_at: config.created_at || new Date().toISOString(),
      expires_at: config.expires_at || getDefaultExpiry(),
      prefix: getKeyPrefix(keyHash),
      workspace_name: workspaceData?.name ?? '',
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

    const body = await request.json();
    const name = (body.name as string) ?? `Ключ ${new Date().toLocaleTimeString('ru-RU')}`;

    // Validate name length
    if (name.length > 100) {
      return NextResponse.json(
        { error: 'invalid_params', message: 'Key name too long (max 100 chars)' },
        { status: 400 },
      );
    }

    // Fetch current settings
    const { data: settingsData, error: fetchError } = await supabase
      .from('workspace_settings')
      .select('mcp_api_keys')
      .eq('workspace_id', workspaceId)
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

    // Store key hash with metadata (legacy mode compatible)
    const newKeys: Record<string, McpKeyConfig> = {
      ...existingKeys,
      [keyHash]: {
        allowed_tools: 'all',
        can_send_messages: true,
        max_tasks_per_minute: 50,
        name,
        created_at: new Date().toISOString(),
        expires_at: getDefaultExpiry(),
      },
    };

    // Update workspace_settings
    const { error: updateError } = await supabase
      .from('workspace_settings')
      .update({ mcp_api_keys: newKeys as any })
      .eq('workspace_id', workspaceId);

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
    });
  } catch (err) {
    console.error('POST /api/mcp-keys error:', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Internal server error' },
      { status: 500 },
    );
  }
}