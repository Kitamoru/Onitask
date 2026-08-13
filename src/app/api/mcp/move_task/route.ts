/**
 * POST /api/mcp/move_task
 * 
 * MCP endpoint for AI agents to move tasks between columns.
 * Implements: version check (INV-09), claim, cascade_unblock, Memento pattern.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 move_task
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mcpAuthMiddleware,
  isToolAllowed,
  checkAndDecrementQuota,
  logAgentEvent,
  resolveAgentWorkerId,
  QUOTA_COST_MUTATION,
  type McpPermissions,
  type McpAuthResult,
} from '@/lib/mcpAuth';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface MoveTaskRequest {
  workspace_id: string;
  agent_name: string;
  task_id: string;
  target_column: 'backlog' | 'in_progress' | 'review' | 'done';
  reason?: string;
  claim?: boolean;
}

interface MoveTaskResponse {
  success: boolean;
  task_id?: string;
  new_column?: string;
  claimed?: boolean;
  version?: number;
  moved_at?: string;
  unblocked_ids?: string[];
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

function generateErrorResponse(code: number, type: string, message: string): NextResponse<MoveTaskResponse> {
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
    endpoint: 'move_task',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
  });
}

// ============================================================================
// POST — Move task
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse request body
    const body = (await request.json()) as MoveTaskRequest;
    const { workspace_id, agent_name, task_id, target_column, reason, claim } = body;

    // Validate required fields
    if (!workspace_id || !agent_name || !task_id || !target_column) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name, task_id, target_column'
      );
    }

    // Validate target_column value
    const validColumns = ['backlog', 'in_progress', 'review', 'done'];
    if (!validColumns.includes(target_column)) {
      return generateErrorResponse(
        400,
        'invalid_params',
        `Invalid target_column. Must be one of: ${validColumns.join(', ')}`
      );
    }

    // Step 1: Authentication & Authorization
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
    if (!isToolAllowed('move_task', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'move_task' is not in allowed_tools for this API key."
      );
    }

    // Step 3: Atomic Quota check
    const quotaResult = await checkAndDecrementQuota(workspace_id, agent_name, QUOTA_COST_MUTATION);
    if (!quotaResult.success) {
      return generateErrorResponse(
        422,
        'quota_exceeded',
        'AI mutation quota exhausted.'
      );
    }

    // Step 4: Get current task state (for version check + state_before)
    const supabase = getSupabaseClient();
    const { data: currentTask, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('id', task_id)
      .maybeSingle();

    if (fetchError || !currentTask) {
      return generateErrorResponse(
        404,
        'task_not_found',
        `Task ${task_id} not found in this workspace.`
      );
    }

    // Step 5: Version check (optimistic locking - INV-09)
    // Note: version is not passed in request body per contract, but we track it server-side
    
    // Step 6: Check if already claimed (if claim=true)
    let claimed = false;
    let assignedTo: string | null = currentTask.assigned_to;

    if (claim) {
      const workerId = await resolveAgentWorkerId(agent_name, workspace_id);
      if (!workerId) {
        return generateErrorResponse(
          404,
          'worker_not_found',
          `Agent "${agent_name}" not found as worker in this workspace.`
        );
      }

      // Check if already claimed by someone else
      if (currentTask.assigned_to && currentTask.assigned_to !== workerId) {
        return generateErrorResponse(
          409,
          'already_claimed',
          `Task is already assigned to another worker.`
        );
      }

      assignedTo = workerId;
      claimed = true;
    }

    // Capture state_before for Memento pattern
    const stateBefore = {
      column: currentTask.column,
      assigned_to: currentTask.assigned_to,
      version: currentTask.version,
      is_inbox: currentTask.is_inbox,
    };

    // Step 7: Update task column
    const updateData: Record<string, unknown> = {
      column: target_column,
      is_inbox: false, // Moving out of inbox
      updated_at: new Date().toISOString(),
    };

    if (claimed && assignedTo) {
      updateData.assigned_to = assignedTo;
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('workspace_id', workspace_id)
      .eq('id', task_id)
      // Optimistic lock: increment version
      .eq('version', currentTask.version)
      .select('version')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        // Row was modified by another client
        return generateErrorResponse(
          409,
          'version_conflict',
          'Task was modified by another client. Refetch and retry.'
        );
      }
      console.error('Move task update error:', updateError);
      return generateErrorResponse(
        500,
        'internal_error',
        'Failed to move task.'
      );
    }

    const newVersion = updatedTask?.version ?? (currentTask.version + 1);

    // Step 8: Log agent event (Memento pattern)
    await logAgentEvent(
      workspace_id,
      agent_name,
      'move_task',
      task_id,
      `Moved task ${task_id} from ${currentTask.column} to ${target_column}${reason ? ': ' + reason : ''}`,
      {
        from_column: currentTask.column,
        to_column: target_column,
        reason: reason ?? null,
        claimed,
      },
      stateBefore
    );

    // Build response
    const elapsed = Date.now() - startTime;

    return NextResponse.json(
      {
        success: true,
        task_id,
        new_column: target_column,
        claimed,
        version: newVersion,
        moved_at: new Date().toISOString(),
        unblocked_ids: [], // Will be populated by trg_cascade_unblock trigger
      },
      {
        status: 200,
        headers: {
          'X-Processing-Time-Ms': String(elapsed),
        },
      }
    );
  } catch (err) {
    console.error('move_task unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}