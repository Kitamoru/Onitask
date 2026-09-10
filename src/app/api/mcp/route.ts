// /api/mcp — Streamable HTTP MCP endpoint (MCP Contract v0.8.0 §2.4.2).
// Stateless JSON-RPC 2.0: initialize / tools/list / tools/call / ping.
// Auth: Authorization Bearer <mcp_agent_keys.key> + X-Agent-Name header.
// workspace_id always resolves from the key (A-7); the agent worker is ensured
// app-level on EVERY authenticated tool call (INV-04; migration 052 removed
// the DB trigger — resolveAgentWorkerId is the single onboarding point).

import {
  bearerFromHeaders,
  assertAgentRequest,
  invalidParams,
  DomainError,
  resolveAgentWorkerId,
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
import { getTaskComments } from '../../../../lib/domain/agent/getTaskComments';
import { undo } from '../../../../lib/domain/agent/undo';
import {
  opsLeaseCore,
  opsHeartbeatCore,
  opsTerminalCore,
  opsAckCore,
  opsNackCore,
} from '../../../../lib/shared/opsTools';
import {
  OpsApiError,
  type OpsRequestContext,
} from '../../../../lib/shared/opsTransport';

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
    description:
      'Send a Telegram message to a linked chat (max 4096 chars) with optional file attachments and an optional task link. ' +
      'attachments: array of {filename, content_base64, caption?} — max 5 files, ≤2MB base64 each, ≤3MB total, MIME whitelist. ' +
      'task_id: when provided, adds an inline «Обсудить задачу» button deep-linking to the task comments tab.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'number' },
        text: { type: 'string', maxLength: 4096 },
        parse_mode: { type: 'string', enum: ['HTML', 'MarkdownV2'] },
        task_id: { type: 'string', description: 'UUID of the related task (adds inline button).' },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              content_base64: { type: 'string' },
              caption: { type: 'string' },
            },
            required: ['filename', 'content_base64'],
            additionalProperties: false,
          },
          maxItems: 5,
        },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'get_task_context',
    description:
      'Full task context: history, agent events, memory, docs, subgraph, attachments. ' +
      'Optional flags to trim payload: include_workspace_context / include_memory_summary (default true — pass false for per-task calls, fetch those once at session start), events_limit (default 20). ' +
      'include_attachments (default false) — when true, returns task attachments metadata + signed download URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        include_workspace_context: { type: 'boolean' },
        include_memory_summary: { type: 'boolean' },
        events_limit: { type: 'number', maximum: 20 },
        include_attachments: { type: 'boolean' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_task_comments',
    description:
      'Read the task comments feed (durable comments + column history + recent agent events). ' +
      'Use to check for new human comments on your task during duty poll (keyset-paginated). Read-only, no quota cost.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        cursor_created: {
          type: 'string',
          description: 'ISO timestamp cursor (feed is DESC) — pass from last item.created_at.',
        },
        cursor_id: { type: 'string' },
        limit: { type: 'number', maximum: 100 },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'ops_lease',
    description:
      'Lease at most one ready task execution for this agent (Arch 0.9 work unit). ' +
      'Returns the execution (execution_id, runtime_id echo, receipt, lease_expires_at, task payload) or { execution: null } when the queue is empty. ' +
      'Billed against the mutation quota (fail-closed). Fencing: keep execution_id + runtime_id and pass them to heartbeat/terminal/ack/nack.',
    inputSchema: {
      type: 'object',
      properties: {
        runtime_id: {
          type: 'string',
          description: 'UUID of this runtime session; regenerated on restart (fencing).',
        },
      },
      required: ['runtime_id'],
    },
  },
  {
    name: 'ops_heartbeat',
    description:
      'Renew the lease on a running execution (extends lease_expires_at). ' +
      'Call periodically during long work; expired leases are reaped and retried.',
    inputSchema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'UUID of the leased execution.' },
        runtime_id: { type: 'string', description: 'UUID of this runtime session (fencing).' },
      },
      required: ['execution_id', 'runtime_id'],
    },
  },
  {
    name: 'ops_terminal',
    description:
      'Fenced completion of an execution: outcome = review | escalate | handoff. ' +
      'This is the ONLY way an agent finishes work in 0.9 — never use move_task for your own task (INV 4). ' +
      'Returns a receipt required by ops_ack. ' +
      'Optional attachments: array of {filename, content_base64, caption?} — files are stored to task attachments and sent to Telegram with the task card (max 5 files, ≤2MB base64 each, ≤3MB total).',
    inputSchema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'UUID of the leased execution.' },
        runtime_id: { type: 'string', description: 'UUID of this runtime session (fencing).' },
        task_id: { type: 'string', description: 'UUID of the leased task.' },
        task_version: { type: 'integer', description: 'CAS version of the task (from the lease).' },
        outcome: { type: 'string', enum: ['review', 'escalate', 'handoff'] },
        summary: { type: 'string' },
        metadata: { type: 'object' },
        next_owner: { type: 'string', description: 'Agent name for handoff outcome.' },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              content_base64: { type: 'string' },
              caption: { type: 'string' },
            },
            required: ['filename', 'content_base64'],
            additionalProperties: false,
          },
          maxItems: 5,
        },
      },
      required: ['execution_id', 'runtime_id', 'task_id', 'task_version', 'outcome'],
    },
  },
  {
    name: 'ops_ack',
    description:
      'Confirm delivery/accept of the terminal result (two-phase delivery). ' +
      'Requires the receipt from ops_terminal; 409 terminal_required if no terminal happened yet.',
    inputSchema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'UUID of the leased execution.' },
        runtime_id: { type: 'string', description: 'UUID of this runtime session (fencing).' },
        receipt: { type: 'string', description: 'Receipt returned by ops_terminal.' },
      },
      required: ['execution_id', 'runtime_id', 'receipt'],
    },
  },
  {
    name: 'ops_nack',
    description:
      'Report a delivery/accept failure (not a business terminal). ' +
      'unsupported_task escalates; other reasons requeue the task under max_attempts.',
    inputSchema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'UUID of the leased execution.' },
        runtime_id: { type: 'string', description: 'UUID of this runtime session (fencing).' },
        receipt: { type: 'string', description: 'Receipt from the lease.' },
        reason: {
          type: 'string',
          enum: ['unsupported_task', 'runtime_busy', 'dependency_unavailable', 'transient_error', 'other'],
        },
        detail: { type: 'string' },
      },
      required: ['execution_id', 'runtime_id', 'receipt', 'reason'],
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

/**
 * Ops tools (Arch 0.9): identity is the KEY identity (INV 9 / ADR R2).
 * The X-Agent-Name header is already required by assertAgentRequest; here we
 * additionally assert it matches the key — mismatch would be 403 in REST too.
 */
function opsCtx(ctx: AgentRequestContext): OpsRequestContext {
  if (ctx.agentName !== ctx.keyAgentName) {
    throw new DomainError(
      403,
      'agent_not_allowed',
      'agent_name does not match the key identity.'
    );
  }
  return { workspaceId: ctx.workspaceId, agentName: ctx.keyAgentName };
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
        task_id: args.task_id as string | undefined,
        attachments: args.attachments as
          | Array<{
              filename: string;
              content_base64: string;
              caption?: string;
            }>
          | undefined,
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
        include_attachments: args.include_attachments as boolean | undefined,
      });
    case 'get_task_comments':
      return getTaskComments({
        ...base,
        task_id: args.task_id as string,
        cursor_created: args.cursor_created as string | undefined,
        cursor_id: args.cursor_id as string | undefined,
        limit: args.limit as number | undefined,
      });
    case 'ops_lease':
      return opsLeaseCore(opsCtx(ctx), args);
    case 'ops_heartbeat':
      return opsHeartbeatCore(opsCtx(ctx), args.execution_id as string, args);
    case 'ops_terminal':
      return opsTerminalCore(opsCtx(ctx), args.execution_id as string, args);
    case 'ops_ack':
      return opsAckCore(opsCtx(ctx), args.execution_id as string, args);
    case 'ops_nack':
      return opsNackCore(opsCtx(ctx), args.execution_id as string, args);
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
        serverInfo: { name: 'onitask', version: '0.9.0' },
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

        // INV-04 zero-config onboarding: the authenticated agent's worker
        // materializes on EVERY tool call — a brand-new key is visible on the
        // board from its very first call (incl. ops_lease and reads).
        // Fail-open: onboarding failure is logged but never fails the request.
        try {
          await resolveAgentWorkerId(ctx.agentName, ctx.workspaceId);
        } catch (onboardingErr) {
          console.error('agent worker onboarding failed:', onboardingErr);
        }

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
        // Arch 0.9 ops errors: same envelope as the Ops REST API (contract 02)
        // — type = machine code, http_status = REST status.
        if (err instanceof OpsApiError) {
          return rpcError(id, -32000, err.message, {
            type: err.code,
            http_status: err.status,
          });
        }
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