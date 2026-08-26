// /api/mcp — Streamable HTTP MCP endpoint (MCP Contract v0.8.0 §2.4.2).
// Stateless JSON-RPC 2.0: initialize / tools/list / tools/call / ping.
// Auth: Authorization Bearer <mcp_agent_keys.key> + X-Agent-Name header.
// workspace_id always resolves from the key (A-7); agent worker auto-created
// by DB trigger on first mutation (INV-04).

import {
  bearerFromHeaders,
  assertAgentRequest,
  invalidParams,
  DomainError,
} from '../../../../lib/shared/mcpAuth';
import { toDomainError } from '../../../../lib/shared/errors';
import type { AgentRequestContext } from '../../../../lib/shared/mcpAuth';
import { getTasksByColumn } from '../../../../lib/domain/agent/getTasksByColumn';
import { getWorkspaceSettings } from '../../../../lib/domain/agent/getWorkspaceSettings';
import { createTask } from '../../../../lib/domain/agent/createTask';
import { moveTask } from '../../../../lib/domain/agent/moveTask';
import { escalateTask } from '../../../../lib/domain/agent/escalateTask';
import { handoffTask } from '../../../../lib/domain/agent/handoffTask';
import { sendMessageToChat } from '../../../../lib/domain/agent/sendMessageToChat';
import { getTaskContext } from '../../../../lib/domain/agent/getTaskContext';
import { waitForTasks } from '../../../../lib/domain/agent/waitForTasks';
import { undo } from '../../../../lib/domain/agent/undo';

// wait_for_tasks holds the request open up to 45s (long-poll) — allow it.
export const maxDuration = 60;

// ============================================================================
// Tool definitions (contract §4.1–4.9)
// ============================================================================

const TOOLS = [
  {
    name: 'get_tasks_by_column',
    description:
      'List tasks in a board column. Use to see what is queued/in progress/in review.',
    inputSchema: {
      type: 'object',
      properties: {
        column: { type: 'string', enum: ['backlog', 'in_progress', 'review', 'done'] },
        limit: { type: 'number', maximum: 50 },
        assigned_to_me: { type: 'boolean' },
        sort_by_blocking_value: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_workspace_settings',
    description: 'Read workspace settings: cognitive budget, flow config, context.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_task',
    description: 'Create a task on the board. Returns full_id like ONI-42.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        column: { type: 'string', enum: ['backlog', 'in_progress', 'review'] },
        assignee: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        deadline: { type: 'string', description: 'ISO 8601' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        complexity: { type: 'number', enum: [1, 2, 3] },
        blocked_by: { type: 'string', description: 'UUID of blocker task' },
      },
      required: ['title'],
    },
  },
  {
    name: 'move_task',
    description: 'Move a task to another column (optimistic locking via version).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        target_column: { type: 'string', enum: ['backlog', 'in_progress', 'review', 'done'] },
        version: { type: 'number' },
        reason: { type: 'string' },
        claim: { type: 'boolean' },
      },
      required: ['task_id', 'target_column', 'version'],
    },
  },
  {
    name: 'escalate_task',
    description: 'Escalate a task to a human (needs_human=true).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        reason: {
          type: 'string',
          enum: ['insufficient_context', 'conflicting_requirements', 'blocked_by', 'out_of_scope'],
        },
        suggested_action: { type: 'string' },
      },
      required: ['task_id', 'reason'],
    },
  },
  {
    name: 'handoff_task',
    description: 'Hand off a task to another agent with mandatory notes.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        target_agent: { type: 'string' },
        handoff_notes: { type: 'string', maxLength: 1000 },
        move_to_column: { type: 'string' },
      },
      required: ['task_id', 'target_agent', 'handoff_notes'],
    },
  },
  {
    name: 'send_message_to_chat',
    description: 'Send a Telegram message to a linked chat (max 4096 chars).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'number' },
        text: { type: 'string', maxLength: 4096 },
        parse_mode: { type: 'string', enum: ['HTML', 'MarkdownV2'] },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'get_task_context',
    description:
      'Full task context: history, agent events, memory, docs, subgraph. ' +
      'Optional flags to trim payload: include_workspace_context / include_memory_summary (default true — pass false for per-task calls, fetch those once at session start), events_limit (default 20).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        include_workspace_context: { type: 'boolean' },
        include_memory_summary: { type: 'boolean' },
        events_limit: { type: 'number', maximum: 20 },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'wait_for_tasks',
    description:
      'Long-poll: block until matching work appears — a NEW or UNACKED task assigned to you (column != done). Delivery is two-phase: process a task, then echo its id back via known_task_ids in your next call to ack it; un-acked tasks are re-delivered after ~10 min, so nothing is ever lost. ' +
      'an APPROVED task of yours (deploy_requests: review→done; autonomy_level=full only), or a task RETURNED from review to you (fix_requests). ' +
      'Call in a loop when idle — duty mode. Returns { status, tasks, deploy_requests?, fix_requests?, waited_ms }. ' +
      'Each approval/rework transition is delivered exactly once. On timeout just call again. Max 45s per call. ' +
      'IMPORTANT: pass poll_seq = previous value + 1 on EVERY call — even when RETRYING after an error — identical consecutive payloads trip client-side loop guards and abort the duty loop. On repeated errors, halve timeout_sec.',
    inputSchema: {
      type: 'object',
      properties: {
        known_task_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'ACK: ids of tasks you have PROCESSED since the previous call (delta only, not full history). Acks survive compacts/restarts server-side.',
        },
        timeout_sec: { type: 'number', maximum: 45 },
        poll_seq: {
          type: 'number',
          description:
            'Monotonic counter (previous call value + 1). Ignored by the server; keeps each call payload unique so MCP clients do not mistake the duty loop for an accidental repetition.',
        },
      },
    },
  },
  {
    name: 'undo',
    description: 'Undo a previous agent event by event_id.',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id'],
    },
  },
] as const;

// ============================================================================
// Dispatch
// ============================================================================

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return Response.json({
    jsonrpc: '2.0',
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  });
}

async function dispatchTool(
  ctx: AgentRequestContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const base = { key: ctx, agentName: ctx.agentName };
  switch (toolName) {
    case 'get_tasks_by_column':
      return getTasksByColumn({
        ...base,
        column: args.column as never,
        limit: args.limit as number | undefined,
        assigned_to_me: args.assigned_to_me as boolean | undefined,
        sort_by_blocking_value: args.sort_by_blocking_value as boolean | undefined,
      });
    case 'get_workspace_settings':
      return getWorkspaceSettings(base);
    case 'create_task':
      return createTask({
        ...base,
        title: args.title as string,
        description: args.description as string | undefined,
        column: args.column as never,
        assignee: args.assignee as string | undefined,
        tags: args.tags as string[] | undefined,
        deadline: args.deadline as string | undefined,
        priority: args.priority as never,
        complexity: args.complexity as 1 | 2 | 3 | undefined,
        blocked_by: args.blocked_by as string | undefined,
      });
    case 'move_task':
      return moveTask({
        ...base,
        task_id: args.task_id as string,
        target_column: args.target_column as never,
        version: args.version as number,
        reason: args.reason as string | undefined,
        claim: args.claim as boolean | undefined,
      });
    case 'escalate_task':
      return escalateTask({
        ...base,
        task_id: args.task_id as string,
        reason: args.reason as never,
        suggested_action: args.suggested_action as string | undefined,
      });
    case 'handoff_task':
      return handoffTask({
        ...base,
        task_id: args.task_id as string,
        target_agent: args.target_agent as string,
        handoff_notes: args.handoff_notes as string,
        move_to_column: args.move_to_column as string | undefined,
      });
    case 'send_message_to_chat':
      return sendMessageToChat({
        ...base,
        chat_id: args.chat_id as number,
        text: args.text as string,
        parse_mode: args.parse_mode as 'HTML' | 'MarkdownV2' | undefined,
      });
    case 'get_task_context':
      return getTaskContext({
        ...base,
        task_id: args.task_id as string,
        include_workspace_context: args.include_workspace_context as
          | boolean
          | undefined,
        include_memory_summary: args.include_memory_summary as
          | boolean
          | undefined,
        events_limit: args.events_limit as number | undefined,
      });
    case 'wait_for_tasks':
      return waitForTasks({
        ...base,
        known_task_ids: args.known_task_ids as string[] | undefined,
        timeout_sec: args.timeout_sec as number | undefined,
        poll_seq: args.poll_seq as number | undefined,
      });
    case 'undo':
      return undo({ ...base, event_id: args.event_id as string });
    default:
      throw invalidParams(`Unknown tool: ${toolName}`);
  }
}

// ============================================================================
// POST — JSON-RPC handler
// ============================================================================

export async function POST(req: Request) {
  let msg: {
    jsonrpc?: string;
    id?: JsonRpcId;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    msg = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  const id = msg.id ?? null;
  const method = msg.method ?? '';

  // Notifications (no id) → accept silently
  if (msg.id === undefined || msg.id === null) {
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return new Response(null, { status: 202 });
    }
    return rpcError(id, -32601, 'Method not found');
  }

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'onitask', version: '0.8.0' },
      });

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = msg.params?.name as string | undefined;
      if (!toolName) {
        return rpcError(id, -32602, 'params.name is required');
      }
      const args =
        (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};

      try {
        // agent_name for MCP transport comes from X-Agent-Name header
        // (fallback: arguments.agent_name for REST-style clients).
        const headerAgent = req.headers.get('x-agent-name')?.trim();
        const body = {
          ...args,
          agent_name: headerAgent || (args.agent_name as string | undefined),
        };

        const rawKey = bearerFromHeaders(req.headers);
        const ctx = await assertAgentRequest({
          rawKey,
          body,
          toolName,
        });

        const result = await dispatchTool(ctx, toolName, args);

        if (
          result &&
          typeof result === 'object' &&
          'success' in result &&
          (result as { success: boolean }).success === false
        ) {
          const err = (result as unknown as {
            error: { code: number; type: string; message: string };
          }).error;
          return rpcError(id, -32000, err.message, { type: err.type, http_status: err.code });
        }

        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        const domainErr = toDomainError(err);
        return rpcError(id, -32000, domainErr.message, {
          type: domainErr.type,
          http_status: domainErr.code,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ============================================================================
// GET / DELETE — stateless server: no SSE stream, no session termination
// ============================================================================

export async function GET() {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'GET not supported (stateless server)' } }),
    { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } }
  );
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}