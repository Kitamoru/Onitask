/**
 * POST /api/mcp/handoff_task
 * 
 * MCP endpoint for planned task handoff between agents.
 * Implements: Memento pattern, atomic update of assigned_to/handoff_to/handoff_notes.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 handoff_task
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

interface HandoffTaskRequest {
  workspace_id: string;
  agent_name: string;
  task_id: string;
  target_agent: string;
  handoff_notes: string;   // required, max 1000 chars
  move_to_column?: string;
}

interface HandoffTaskResponse {
  success: boolean;
  task_id?: string;
  handed_off_to?: string;
  new_column?: string | null;
  version?: number;
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

function generateErrorResponse(code: number, type: string, message: string): NextResponse<HandoffTaskResponse> {
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
    endpoint: 'handoff_task',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
  });
}

// ============================================================================
// POST — Handoff task
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = (await request.json()) as HandoffTaskRequest;
    const { workspace_id, agent_name, task_id, target_agent, handoff_notes, move_to_column } = body;

    // Validate required fields
    if (!workspace_id || !agent_name || !task_id || !target_agent || !handoff_notes) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name, task_id, target_agent, handoff_notes'
      );
    }

    // Validate handoff_notes length
    if (handoff_notes.length > 1000) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'handoff_notes must be max 1000 characters.'
      );
    }

    // Validate move_to_column if provided
    if (move_to_column) {
      const validColumns = ['backlog', 'in_progress', 'review', 'done'];
      if (!validColumns.includes(move_to_column)) {
        return generateErrorResponse(
          400,
          'invalid_params',
          `Invalid move_to_column. Must be one of: ${validColumns.join(', ')}`
        );
      }
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
    if (!isToolAllowed('handoff_task', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'handoff_task' is not in allowed_tools for this API key."
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

    // Step 4: Get current task state
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

    // Resolve target agent worker ID
    const targetWorkerId = await resolveAgentWorkerId(target_agent, workspace_id);
    if (!targetWorkerId) {
      return generateErrorResponse(
        404,
        'worker_not_found',
        `Target agent "${target_agent}" not found or inactive in this workspace.`
      );
    }

    // Capture state_before for Memento pattern
    const stateBefore = {
      column: currentTask.column,
      assigned_to: currentTask.assigned_to,
      handoff_to: currentTask.handoff_to,
      handoff_notes: currentTask.handoff_notes,
      version: currentTask.version,
    };

    // Step 5: Update task atomically
    const updateData: Record<string, unknown> = {
      handoff_to: targetWorkerId,
      handoff_notes,
      updated_at: new Date().toISOString(),
    };

    // If move_to_column specified, update column and clear inbox flag
    if (move_to_column) {
      updateData.column = move_to_column;
      updateData.is_inbox = false;
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('workspace_id', workspace_id)
      .eq('id', task_id)
      .select('version')
      .single();

    if (updateError) {
      console.error('Handoff task update error:', updateError);
      return generateErrorResponse(
        500,
        'internal_error',
        'Failed to handoff task.'
      );
    }

    // Step 6: Log agent event (Memento pattern)
    await logAgentEvent(
      workspace_id,
      agent_name,
      'handoff_task',
      task_id,
      `Handed off task ${task_id} to ${target_agent}${move_to_column ? ' → ' + move_to_column : ''}`,
      {
        target_agent,
        target_worker_id: targetWorkerId,
        handoff_notes,
        move_to_column: move_to_column ?? null,
        state_before: stateBefore,
      },
      stateBefore
    );

    // Note: trg_handoff_chain_alert fires automatically via database trigger

    return NextResponse.json({
      success: true,
      task_id,
      handed_off_to: target_agent,
      new_column: move_to_column ?? null,
      version: updatedTask?.version,
    });
  } catch (err) {
    console.error('handoff_task unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}