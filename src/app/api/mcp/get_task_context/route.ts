/**
 * POST /api/mcp/get_task_context
 * 
 * MCP endpoint for getting full task context including column_history,
 * agent_events, memory_summary, workspace_context, relevant_docs, subgraph.
 * Read-only tool - no quota consumption.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 get_task_context
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mcpAuthMiddleware,
  isToolAllowed,
  getAgentEventsForTask,
  getTaskColumnHistory,
  getTaskSubgraph,
  type McpPermissions,
  type McpAuthResult,
} from '@/lib/mcpAuth';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface GetTaskContextRequest {
  workspace_id: string;
  agent_name: string;
  task_id: string;
}

interface TaskContext {
  id: string;
  full_id: string;
  task_number: number;
  title: string;
  description: string | null;
  column: string;
  priority: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  is_blocked: boolean;
  is_inbox: boolean;
  needs_human: boolean;
  escalation_reason: string | null;
  deadline: string | null;
  version: number;
  metadata: Record<string, unknown>;
  moved_to_column_at: string | null;
}

interface ColumnHistoryEntry {
  from_column: string | null;
  to_column: string;
  moved_by: string | null;
  moved_at: string;
  metadata: Record<string, unknown> | null;
}

interface AgentEventEntry {
  tool: string;
  agent_name: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface RelevantDoc {
  filename: string;
  section: string;
  content: string;
  similarity: number;
}

interface SubgraphEdge {
  from_task_id: string;
  to_task_id: string;
  relation_type: 'blocks' | 'spawned_from' | 'mentions';
  weight: number;
  depth: 1 | 2;
}

interface GetTaskContextResponse {
  success: boolean;
  task?: TaskContext;
  column_history?: ColumnHistoryEntry[];
  agent_events?: AgentEventEntry[];
  memory_summary?: string | null;
  workspace_context?: string | null;
  relevant_docs?: RelevantDoc[] | null;
  subgraph?: SubgraphEdge[] | null;
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

function generateErrorResponse(code: number, type: string, message: string): NextResponse<GetTaskContextResponse> {
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
    endpoint: 'get_task_context',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
    readOnly: true, // No quota consumed
  });
}

// ============================================================================
// POST — Get task context
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = (await request.json()) as GetTaskContextRequest;
    const { workspace_id, agent_name, task_id } = body;

    // Validate required fields
    if (!workspace_id || !agent_name || !task_id) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name, task_id'
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
    if (!isToolAllowed('get_task_context', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'get_task_context' is not in allowed_tools for this API key."
      );
    }

    // Step 3: Fetch task details
    const supabase = getSupabaseClient();
    const { data: task, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('id', task_id)
      .maybeSingle();

    if (fetchError || !task) {
      return generateErrorResponse(
        404,
        'task_not_found',
        `Task ${task_id} not found in this workspace.`
      );
    }

    // Step 4: Get column history
    const columnHistory = await getTaskColumnHistory(workspace_id, task_id);

    // Step 5: Get agent events (last 20)
    const agentEvents = await getAgentEventsForTask(workspace_id, task_id);

    // Step 6: Get subgraph (task_relations edges)
    const subgraph = await getTaskSubgraph(workspace_id, task_id);

    // Step 7: Get workspace_context
    const { data: wsSettings } = await supabase
      .from('workspace_settings')
      .select('workspace_context')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    const workspaceContext = (wsSettings?.workspace_context as string) ?? null;

    // Step 8: Get memory_summary (from agent_memory if exists)
    let memorySummary: string | null = null;
    const { data: memoryData } = await supabase
      .from('agent_memory')
      .select('content')
      .eq('workspace_id', workspace_id)
      .eq('source_id', `${task_id}_summary`)
      .maybeSingle();
    memorySummary = (memoryData?.content as string) ?? null;

    // Step 9: Get relevant_docs (skip for minimal sharing level)
    let relevantDocs: RelevantDoc[] | null = null;
    const { data: settings } = await supabase
      .from('workspace_settings')
      .select('data_sharing_level')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    const sharingLevel = (settings?.data_sharing_level as string) ?? 'standard';
    if (sharingLevel !== 'minimal') {
      // TODO: Implement semantic search via match_doc_chunks RPC when doc_kb_config is set
      // For now, return null (graceful degradation)
      relevantDocs = null;
    }

    // Step 10: Build response
    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        full_id: (task as any).full_id ?? '',
        task_number: (task as any).task_number ?? 0,
        title: task.title,
        description: task.description,
        column: task.column,
        priority: task.priority,
        assigned_to: task.assigned_to,
        reviewer_id: task.reviewer_id,
        is_blocked: task.is_blocked,
        is_inbox: task.is_inbox,
        needs_human: task.needs_human,
        escalation_reason: task.escalation_reason,
        deadline: task.deadline,
        version: task.version,
        metadata: (task.metadata as Record<string, unknown>) ?? {},
        moved_to_column_at: task.moved_to_column_at,
      },
      column_history: columnHistory,
      agent_events: agentEvents,
      memory_summary: memorySummary,
      workspace_context: workspaceContext,
      relevant_docs: relevantDocs,
      subgraph,
    });
  } catch (err) {
    console.error('get_task_context unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}