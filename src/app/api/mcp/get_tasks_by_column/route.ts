/**
 * POST /api/mcp/get_tasks_by_column
 * 
 * MCP endpoint for reading tasks by column with Smart Backlog support.
 * Read-only tool - no quota consumption.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 get_tasks_by_column
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

interface GetTasksByColumnRequest {
  workspace_id: string;
  agent_name: string;
  column: 'backlog' | 'in_progress' | 'review' | 'done';
  limit?: number;   // default 20, max 50
  assigned_to_me?: boolean;
  sort_by_blocking_value?: boolean; // v0.6.0: Smart Backlog
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
  blocking_value?: number; // v0.6.0: only when sort_by_blocking_value=true
}

interface GetTasksByColumnResponse {
  success: boolean;
  tasks?: TaskPreview[];
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

function generateErrorResponse(code: number, type: string, message: string): NextResponse<GetTasksByColumnResponse> {
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
    endpoint: 'get_tasks_by_column',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
    readOnly: true, // No quota consumed
  });
}

// ============================================================================
// POST — Get tasks by column
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = (await request.json()) as GetTasksByColumnRequest;
    const { workspace_id, agent_name, column, limit: reqLimit, assigned_to_me, sort_by_blocking_value } = body;

    // Validate required fields
    if (!workspace_id || !agent_name || !column) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name, column'
      );
    }

    // Validate column value
    const validColumns = ['backlog', 'in_progress', 'review', 'done'];
    if (!validColumns.includes(column)) {
      return generateErrorResponse(
        400,
        'invalid_params',
        `Invalid column. Must be one of: ${validColumns.join(', ')}`
      );
    }

    // Validate and set limit
    const limit = Math.min(reqLimit ?? 20, 50);

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
    if (!isToolAllowed('get_tasks_by_column', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'get_tasks_by_column' is not in allowed_tools for this API key."
      );
    }

    // Step 3: Query tasks
    const supabase = getSupabaseClient();

    let query = supabase
      .from('tasks')
      .select('id, title, column, assigned_to, reviewer_id, version, is_inbox, is_blocked, full_id, task_number')
      .eq('workspace_id', workspace_id)
      .eq('column', column)
      .order('created_at', { ascending: true })
      .limit(limit);

    // Filter by assigned_to_me (matches source_id = agent_name)
    if (assigned_to_me) {
      // We need to resolve agent_name to worker ID first
      const { data: worker } = await supabase
        .from('workers')
        .select('id')
        .eq('source_id', agent_name)
        .eq('workspace_id', workspace_id)
        .maybeSingle();

      if (worker) {
        query = query.eq('assigned_to', worker.id);
      } else {
        // Agent not found → return empty
        return NextResponse.json({ success: true, tasks: [] });
      }
    }

    const { data: tasks, error: fetchError } = await query;

    if (fetchError) {
      console.error('Get tasks error:', fetchError);
      return generateErrorResponse(
        500,
        'internal_error',
        'Failed to fetch tasks.'
      );
    }

    // Step 4: Smart Backlog - add blocking_value if requested
    let resultTasks: TaskPreview[] = (tasks ?? []).map(t => ({
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
    }));

    if (sort_by_blocking_value && column === 'backlog') {
      // Calculate blocking_value for each task
      // blocking_value = count of downstream tasks that this task blocks
      // via task_relations WHERE relation_type='blocks'
      for (const task of resultTasks) {
        const { count } = await supabase
          .from('task_relations')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspace_id)
          .eq('from_task_id', task.id)
          .eq('relation_type', 'blocks');

        (task as any).blocking_value = count ?? 0;
      }

      // Sort by blocking_value descending (highest leverage first)
      resultTasks.sort((a, b) => ((b as any).blocking_value ?? 0) - ((a as any).blocking_value ?? 0));

      // Add blocking_value to response
      resultTasks = resultTasks.map(t => ({
        ...t,
        blocking_value: (t as any).blocking_value ?? 0,
      }));
    }

    return NextResponse.json({ success: true, tasks: resultTasks });
  } catch (err) {
    console.error('get_tasks_by_column unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}