/**
 * POST /api/mcp/undo/:eventId
 * 
 * MCP endpoint for agents to undo their last action via Memento pattern.
 * 5-minute window, requires same agent_name + workspace_id.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 undo
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mcpAuthMiddleware,
  isToolAllowed,
  logAgentEvent,
  type McpPermissions,
  type McpAuthResult,
} from '@/lib/mcpAuth';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface UndoRequest {
  workspace_id: string;
  agent_name: string;
}

interface UndoResponse {
  success: boolean;
  event_id?: string;
  tool?: string;
  reverted_at?: string;
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

function generateErrorResponse(code: number, type: string, message: string): NextResponse<UndoResponse> {
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
    endpoint: 'undo',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
    note: 'Pass event_id in URL path: POST /api/mcp/undo/:eventId',
  });
}

// ============================================================================
// POST — Undo action
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    // Parse request body
    const body = (await request.json()) as UndoRequest;
    const { workspace_id, agent_name } = body;
    const eventId = (await params).eventId;

    // Validate required fields
    if (!workspace_id || !agent_name) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name'
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
    if (!isToolAllowed('undo', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'undo' is not in allowed_tools for this API key."
      );
    }

    // Step 3: Find the agent event by ID
    const supabase = getSupabaseClient();
    const { data: event, error: fetchError } = await supabase
      .from('agent_events')
      .select('*')
      .eq('id', eventId)
      .eq('workspace_id', workspace_id)
      .eq('agent_name', agent_name)
      .maybeSingle();

    if (fetchError || !event) {
      return generateErrorResponse(
        404,
        'event_not_found',
        `Event ${eventId} not found or not owned by this agent.`
      );
    }

    // Step 4: Check 5-minute window
    const eventTime = new Date(event.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - eventTime.getTime()) / 60000;

    if (diffMinutes > 5) {
      return generateErrorResponse(
        410,
        'undo_window_expired',
        `Undo window expired: event is ${Math.round(diffMinutes)} minutes old (max 5 minutes).`
      );
    }

    // Step 5: Get state_before from metadata
    const metadata = (event.metadata as Record<string, unknown>) ?? {};
    const stateBefore = (metadata.state_before as Record<string, unknown>) ?? null;

    if (!stateBefore) {
      return generateErrorResponse(
        400,
        'no_state_before',
        'This event does not have state_before data. Cannot undo.'
      );
    }

    // Step 6: Revert based on tool type
    const tool = event.tool;
    let revertedAt: string;

    switch (tool) {
      case 'create_task': {
        // Delete the task that was created
        const taskId = event.resource_id;
        if (taskId) {
          await supabase.from('tasks').delete().eq('id', taskId);
          
          // Delete any task_relations edges
          await supabase
            .from('task_relations')
            .delete()
            .or(`from_task_id.eq.${taskId},to_task_id.eq.${taskId}`);
        }
        revertedAt = new Date().toISOString();
        break;
      }

      case 'move_task': {
        // Restore column and assigned_to from state_before
        const taskId = event.resource_id;
        if (taskId && stateBefore.column && stateBefore.assigned_to) {
          await supabase
            .from('tasks')
            .update({
              column: stateBefore.column as string,
              assigned_to: stateBefore.assigned_to as string,
              is_inbox: (stateBefore.is_inbox as boolean) ?? false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', taskId);
        }
        revertedAt = new Date().toISOString();
        break;
      }

      case 'escalate_task': {
        // Clear needs_human and escalation_reason
        const taskId = event.resource_id;
        if (taskId) {
          await supabase
            .from('tasks')
            .update({
              needs_human: false,
              escalation_reason: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', taskId);
        }
        revertedAt = new Date().toISOString();
        break;
      }

      case 'handoff_task': {
        // Clear handoff_to and handoff_notes
        const taskId = event.resource_id;
        if (taskId) {
          await supabase
            .from('tasks')
            .update({
              handoff_to: null,
              handoff_notes: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', taskId);
        }
        revertedAt = new Date().toISOString();
        break;
      }

      default: {
        return generateErrorResponse(
          400,
          'unsupported_tool',
          `Undo not supported for tool: ${tool}`
        );
      }
    }

    // Step 7: Mark event as undone
    await supabase
      .from('agent_events')
      .update({ is_undone: true })
      .eq('id', eventId);

    // Step 8: Log undo event
    await logAgentEvent(
      workspace_id,
      agent_name,
      'undo',
      event.resource_id ?? null,
      `Undid previous action: ${event.tool}`,
      {
        original_event_id: eventId,
        original_tool: tool,
        state_before: stateBefore,
      },
      null
    );

    return NextResponse.json({
      success: true,
      event_id: eventId,
      tool,
      reverted_at: revertedAt,
    });
  } catch (err) {
    console.error('undo unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}