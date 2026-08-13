/**
 * POST /api/mcp/get_workspace_settings
 * 
 * MCP endpoint for reading workspace settings including agent_active_tasks.
 * Read-only tool - no quota consumption.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 get_workspace_settings
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mcpAuthMiddleware,
  isToolAllowed,
  type McpPermissions,
  type McpAuthResult,
} from '@/lib/mcpAuth';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface GetWorkspaceSettingsRequest {
  workspace_id: string;
  agent_name: string;
}

interface TaskPreview {
  id: string;
  title: string;
  column: string;
  assigned_to: string | null;
  reviewer_id: string | null;
  version: number;
  is_inbox: boolean;
  is_blocked: boolean;
  full_id: string;
  task_number: number;
  needs_human?: boolean;
}

interface GetWorkspaceSettingsResponse {
  success: boolean;
  settings?: {
    enable_cognitive_budget: boolean;
    story_points_config: Record<string, unknown>;
    velocity_window_days: number;
    flow_config: Record<string, unknown>;
    realtime_subscription_level: 'own_tasks' | 'all';
    workspace_context: string | null;
    workspace_context_cache: string | null;
    context_stale: boolean;
    doc_kb_config: Record<string, unknown> | null;
    agent_active_tasks: TaskPreview[] | null;
  };
  error?: {
    code: number;
    type: string;
    message: string;
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceRoleKey);
}

function generateErrorResponse(code: number, type: string, message: string): NextResponse<GetWorkspaceSettingsResponse> {
  return NextResponse.json(
    { success: false, error: { code, type, message } },
    { status: code }
  );
}

// ============================================================================
// GET — Health check / documentation
// ============================================================================

export async function GET() {
  return NextResponse.json({
    endpoint: 'get_workspace_settings',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
    readOnly: true, // No quota consumed
  });
}

// ============================================================================
// POST — Get workspace settings
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = (await request.json()) as GetWorkspaceSettingsRequest;
    const { workspace_id, agent_name } = body;

    // Validate required fields
    if (!workspace_id || !agent_name) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name'
      );
    }

    // Step 1: Authentication & Authorization (read-only - no quota needed)
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    const authResult: McpAuthResult = await mcpAuthMiddleware(headersObj, {
      workspace_id,
      agent_name,
    });

    if (!authResult.success) {
      return generateErrorResponse(
        authResult.errorType === 'unauthorized' ? 401 : 403,
        authResult.errorType || 'internal_error',
        authResult.errorMessage || 'Authentication failed'
      );
    }

    const permissions: McpPermissions = authResult.permissions!;

    // Step 2: Allowed Tools check
    if (!isToolAllowed('get_workspace_settings', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'get_workspace_settings' is not in allowed_tools for this API key."
      );
    }

    // Step 3: Fetch workspace settings
    const supabase = getSupabaseClient();
    const { data: settings, error: fetchError } = await supabase
      .from('workspace_settings')
      .select('*')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (fetchError || !settings) {
      return generateErrorResponse(
        404,
        'workspace_not_found',
        `Workspace ${workspace_id} not found.`
      );
    }

    // Step 4: Get agent_active_tasks (in_progress/review with needs_human=false)
    // First resolve agent worker ID
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', agent_name)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    let agentActiveTasks: TaskPreview[] | null = null;

    if (worker) {
      const { data: activeTasks } = await supabase
        .from('tasks')
        .select('id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, full_id, task_number, needs_human')
        .eq('workspace_id', workspace_id)
        .eq('assigned_to', worker.id)
        .in('column', ['in_progress', 'review'])
        .eq('needs_human', false);

      agentActiveTasks = (activeTasks ?? []).map(t => ({
        id: t.id,
        title: t.title,
        column: t.column,
        assigned_to: t.assigned_to,
        reviewer_id: t.reviewer_id,
        version: t.version,
        is_inbox: t.is_inbox,
        is_blocked: t.is_blocked,
        full_id: (t as any).full_id ?? '',
        task_number: (t as any).task_number ?? 0,
        needs_human: t.needs_human,
      }));
    }

    // Step 5: Build response
    return NextResponse.json({
      success: true,
      settings: {
        enable_cognitive_budget: (settings.enable_cognitive_budget as boolean) ?? false,
        story_points_config: (settings.story_points_config as Record<string, unknown>) ?? {},
        velocity_window_days: (settings.velocity_window_days as number) ?? 7,
        flow_config: (settings.flow_config as Record<string, unknown>) ?? {},
        realtime_subscription_level: (settings.realtime_subscription_level as 'own_tasks' | 'all') ?? 'own_tasks',
        workspace_context: (settings.workspace_context as string) ?? null,
        workspace_context_cache: (settings.workspace_context_cache as string) ?? null,
        context_stale: (settings.context_stale as boolean) ?? false,
        doc_kb_config: (settings.doc_kb_config as Record<string, unknown>) ?? null,
        agent_active_tasks: agentActiveTasks,
      },
    });
  } catch (err) {
    console.error('get_workspace_settings unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}