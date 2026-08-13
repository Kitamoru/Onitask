/**
 * POST /api/mcp/create_task
 * 
 * MCP endpoint for AI agents to create tasks autonomously.
 * Implements: timingSafeEqual, Tenant Isolation, Allowed Tools, Atomic Quota,
 * Rate Limiting (50/min), DFS Cycle Check, Memento pattern.
 * 
 * Contract: docs/onitask_mcp_contract_.md §4 create_task
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mcpAuthMiddleware,
  isToolAllowed,
  checkAndDecrementQuota,
  checkTaskCreationRateLimit,
  logAgentEvent,
  detectCircularDependency,
  resolveAgentWorkerId,
  DEFAULT_MAX_TASKS_PER_MINUTE,
  QUOTA_COST_MUTATION,
  type McpPermissions,
  type McpAuthResult,
} from '@/lib/mcpAuth';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface CreateTaskRequest {
  workspace_id: string;
  agent_name: string;
  title: string;
  description?: string;
  column?: 'backlog' | 'in_progress' | 'review';
  assignee?: string;
  tags?: string[];
  deadline?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  complexity?: 1 | 2 | 3;
  blocked_by?: string; // UUID of blocker task
}

interface CreateTaskResponse {
  success: boolean;
  task?: {
    task_id: string;
    task_number: number;
    full_id: string;
    title: string;
    column: string;
    created_at: string;
    version: number;
    relation_created: boolean;
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

function inferComplexity(description?: string): 1 | 2 | 3 {
  if (!description) return 1;
  const lower = description.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) return 1;
  if (lower.includes('feature') || lower.includes('implement') || lower.includes('add')) return 2;
  return 3;
}

function generateErrorResponse(code: number, type: string, message: string): NextResponse<CreateTaskResponse> {
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
    endpoint: 'create_task',
    method: 'POST',
    contract: 'docs/onitask_mcp_contract_.md §4',
    rateLimit: `${DEFAULT_MAX_TASKS_PER_MINUTE} tasks/min per agent per workspace`,
  });
}

// ============================================================================
// POST — Create task
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse request body
    const body = (await request.json()) as CreateTaskRequest;
    const {
      workspace_id,
      agent_name,
      title,
      description,
      column,
      assignee,
      tags,
      deadline,
      priority,
      complexity,
      blocked_by,
    } = body;

    // Validate required fields
    if (!workspace_id || !agent_name || !title) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Missing required fields: workspace_id, agent_name, title'
      );
    }

    // Validate column value if provided
    const validColumns = ['backlog', 'in_progress', 'review'];
    if (column && !validColumns.includes(column)) {
      return generateErrorResponse(
        400,
        'invalid_params',
        `Invalid column value. Must be one of: ${validColumns.join(', ')}`
      );
    }

    // Validate priority value if provided
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (priority && !validPriorities.includes(priority)) {
      return generateErrorResponse(
        400,
        'invalid_params',
        `Invalid priority value. Must be one of: ${validPriorities.join(', ')}`
      );
    }

    // Validate complexity value if provided
    if (complexity && ![1, 2, 3].includes(complexity)) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Invalid complexity value. Must be 1, 2, or 3.'
      );
    }

    // Validate deadline format if provided
    if (deadline && isNaN(Date.parse(deadline))) {
      return generateErrorResponse(
        400,
        'invalid_params',
        'Invalid deadline format. Use ISO 8601.'
      );
    }

    // Determine default column and is_inbox
    const resolvedColumn = column ?? 'backlog';
    const isInbox = !column; // No explicit column → inbox

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
    if (!isToolAllowed('create_task', permissions)) {
      return generateErrorResponse(
        403,
        'tool_not_permitted',
        "Tool 'create_task' is not in allowed_tools for this API key."
      );
    }

    // Step 3: Rate Limiting
    const maxTasksPerMinute = permissions.max_tasks_per_minute;
    const rateLimitResult = checkTaskCreationRateLimit(agent_name, workspace_id, maxTasksPerMinute);
    if (!rateLimitResult.allowed) {
      return generateErrorResponse(
        429,
        'task_creation_rate_limit',
        `Rate limit exceeded: max ${maxTasksPerMinute} tasks/min per agent. Retry after ${Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000)}s.`
      );
    }

    // Step 4: Atomic Quota check
    const quotaResult = await checkAndDecrementQuota(workspace_id, agent_name, QUOTA_COST_MUTATION);
    if (!quotaResult.success) {
      return generateErrorResponse(
        422,
        'quota_exceeded',
        'AI mutation quota exhausted. Use send_message_to_chat (separate light limit) or wait for quota reset.'
      );
    }

    // Step 5: Resolve assignee worker ID if provided
    let assignedTo: string | null = null;
    if (assignee) {
      const workerId = await resolveAgentWorkerId(assignee, workspace_id);
      if (!workerId) {
        return generateErrorResponse(
          404,
          'worker_not_found',
          `Worker "${assignee}" not found or inactive in this workspace.`
        );
      }
      assignedTo = workerId;
    }

    // Step 6: DFS Cycle Check if blocked_by provided
    let relationCreated = false;
    if (blocked_by) {
      // Verify blocker exists
      const supabase = getSupabaseClient();
      const { data: blockerTask } = await supabase
        .from('tasks')
        .select('id')
        .eq('workspace_id', workspace_id)
        .eq('id', blocked_by)
        .maybeSingle();

      if (!blockerTask) {
        return generateErrorResponse(
          404,
          'blocker_not_found',
          'Task specified in blocked_by does not exist in this workspace.'
        );
      }

      // Check for circular dependency
      const hasCycle = await detectCircularDependency(workspace_id, blocked_by, '');
      if (hasCycle) {
        return generateErrorResponse(
          409,
          'circular_dependency',
          'blocked_by creates a dependency cycle. Task cannot block itself transitively.'
        );
      }
    }

    // Step 7: Insert task
    const supabase = getSupabaseClient();
    
    // Get next task number atomically
    const { data: counterData, error: counterError } = await supabase.rpc('next_task_number', {
      p_workspace_id: workspace_id,
    });

    if (counterError || !counterData) {
      return generateErrorResponse(
        500,
        'internal_error',
        'Failed to generate task number.'
      );
    }

    const taskNumber: number = counterData;
    const fullId = `${workspace_id.substring(0, 5).toUpperCase()}-${taskNumber}`;
    const resolvedComplexity = complexity ?? inferComplexity(description);
    const resolvedPriority = priority ?? 'medium';
    const enrichmentStrategy = 'standard';
    const cognitiveWeight = 1; // Will be updated by F-03 enrichment

    const { data: newTask, error: insertError } = await supabase
      .from('tasks')
      .insert({
        workspace_id,
        title,
        description: description ?? null,
        raw_input: `${title}\n${description ?? ''}`,
        column: resolvedColumn,
        priority: resolvedPriority,
        assigned_to: assignedTo,
        tags: tags ?? [],
        deadline: deadline ? new Date(deadline).toISOString() : null,
        complexity: resolvedComplexity,
        is_inbox: isInbox,
        is_blocked: !!blocked_by,
        source: 'mcp',
        enrichment_strategy: enrichmentStrategy,
        cognitive_weight: cognitiveWeight,
        clarity_score: null,
        version: 1,
      })
      .select('id, task_number, title, column, created_at, version')
      .single();

    if (insertError || !newTask) {
      console.error('Task insert error:', insertError);
      return generateErrorResponse(
        500,
        'internal_error',
        'Failed to create task.'
      );
    }

    // Step 8: Create task_relations edge if blocked_by provided
    if (blocked_by) {
      await supabase.from('task_relations').insert({
        workspace_id,
        from_task_id: blocked_by,
        to_task_id: newTask.id,
        relation_type: 'blocks',
        weight: 1.0,
      });
      relationCreated = true;
    }

    // Step 9: Log agent event (Memento pattern)
    await logAgentEvent(
      workspace_id,
      agent_name,
      'create_task',
      newTask.id,
      `Created task: ${title}`,
      {
        column: resolvedColumn,
        priority: resolvedPriority,
        complexity: resolvedComplexity,
        blocked_by: blocked_by ?? null,
        relation_created: relationCreated,
      },
      null // state_before: N/A for creation
    );

    // Step 10: Broadcast via Realtime
    // Next.js App Router handles this automatically through Supabase realtime channels

    // Build response
    const responseTask = {
      task_id: newTask.id,
      task_number: newTask.task_number,
      full_id: fullId,
      title: newTask.title,
      column: newTask.column,
      created_at: newTask.created_at,
      version: newTask.version,
      relation_created: relationCreated,
    };

    const elapsed = Date.now() - startTime;

    return NextResponse.json(
      { success: true, task: responseTask },
      {
        status: 200,
        headers: {
          'X-Processing-Time-Ms': String(elapsed),
        },
      }
    );
  } catch (err) {
    console.error('create_task unexpected error:', err);
    return generateErrorResponse(
      500,
      'internal_error',
      'Internal server error.'
    );
  }
}