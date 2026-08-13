/**
 * POST /api/mcp/escalate_task
 * 
 * MCP endpoint for AI agents to escalate tasks to human operators.
 * Implements: Memento pattern, alert triggers (already created in DB-14).
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 escalate_task
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mcpAuthMiddleware,
  isToolAllowed,
  checkAndDecrementQuota,
  logAgentEvent,
  QUOTA_COST_MUTATION,
  type McpPermissions,
  type McpAuthResult,
} from '@/lib/mcpAuth';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface EscalateTaskRequest {
  workspace_id: string;
  agent_name: string;
  task_id: string;
  reason: 'insufficient_context' | 'conflicting_requirements' | 'blocked_by' | 'out_of_scope';
  suggested_action?: string;
}

interface EscalateTaskResponse {
  success: boolean;
  task_id?: string;
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

function generateErrorResponse(code: number, type: string, message: string): NextResponse<EscalateTaskResponse> {
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
    endpoint: 'escalate_task',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
  });
}

// ============================================================================
// POST — Escalate task
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = (await request.json()) as EscalateTaskRequest;
    const { workspace_id, agent_name, task_id, reason, suggested_action } = body;

    // Validate required fields
    if (!workspace_id || !agent_name || !task_id || !reason) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name, task_id, reason'
      );
    }

    // Validate reason value
    const validReasons = ['insufficient_context', 'conflicting_requirements', 'blocked_by', 'out_of_scope'];
    if (!validReasons.includes(reason)) {
      return generateErrorResponse(
        400,
        'invalid_params',
        `Invalid reason. Must be one of: ${validReasons.join(', ')}`
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
    if (!isToolAllowed('escalate_task', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'escalate_task' is not in allowed_tools for this API key."
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

    // Capture state_before for Memento pattern
    const stateBefore = {
      column: currentTask.column,
      needs_human: currentTask.needs_human,
      escalation_reason: currentTask.escalation_reason,
      version: currentTask.version,
    };

    // Step 5: Update task - set needs_human=true and escalation_reason
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        needs_human: true,
        escalation_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspace_id)
      .eq('id', task_id);

    if (updateError) {
      console.error('Escalate task update error:', updateError);
      return generateErrorResponse(
        500,
        'internal_error',
        'Failed to escalate task.'
      );
    }

    // Step 6: Log agent event (Memento pattern)
    await logAgentEvent(
      workspace_id,
      agent_name,
      'escalate_task',
      task_id,
      `Escalated task ${task_id}: ${reason}${suggested_action ? ' - ' + suggested_action : ''}`,
      {
        reason,
        suggested_action: suggested_action ?? null,
        state_before: stateBefore,
      },
      stateBefore
    );

    // Note: Alert triggers (trg_escalation_alert) fire automatically via database trigger

    return NextResponse.json({ success: true, task_id });
  } catch (err) {
    console.error('escalate_task unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}