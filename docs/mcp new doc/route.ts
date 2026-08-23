/**
 * Native MCP 2026-07-28 Streamable HTTP — POST /mcp
 * Copy to: app/mcp/route.ts
 *
 * Headers:
 *   Authorization: Bearer <api_key>
 *   MCP-Protocol-Version: 2026-07-28
 *   Mcp-Method: server/discover | tools/list | tools/call
 *   Mcp-Name: <tool> (optional on tools/call)
 */

import {
  assertAgentRequest,
  extractBearer,
} from '../../shared/mcpAuth';
import { DomainError } from '../../shared/errors';
import { createTask } from '../../domain/agent/createTask';
import { moveTask } from '../../domain/agent/moveTask';

declare function getSupabase(): any;
declare function wouldCreateCycle(blockerId: string, workspaceId: string): Promise<boolean>;
declare function resolveAgentWorkerId(workspaceId: string, agentName: string): Promise<string>;

const PROTOCOL = '2026-07-28';
const TOOL_NAMES = [
  'get_workspace_settings',
  'get_tasks_by_column',
  'get_task_context',
  'create_task',
  'move_task',
  'handoff_task',
  'escalate_task',
  'send_message_to_chat',
  'undo',
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

const TOOLS_CATALOG = TOOL_NAMES.map((name) => ({
  name,
  description: descriptionFor(name),
  inputSchema: {
    type: 'object',
    properties: {
      agent_name: { type: 'string' },
      workspace_id: { type: 'string' },
      ...schemaPropsFor(name),
    },
    required: requiredFor(name),
  },
}));

export async function POST(req: Request): Promise<Response> {
  const method = req.headers.get('Mcp-Method') ?? req.headers.get('mcp-method');
  const protocol =
    req.headers.get('MCP-Protocol-Version') ??
    req.headers.get('mcp-protocol-version');

  if (protocol && protocol !== PROTOCOL) {
    return jsonRpcError(null, -32600, `Unsupported protocol version: ${protocol}`);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const id = body?.id ?? null;

  try {
    switch (method) {
      case 'server/discover':
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersions: [PROTOCOL],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'onitask', version: '0.8.0' },
          },
        });

      case 'tools/list':
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            tools: TOOLS_CATALOG,
            ttlMs: 60_000,
            cacheScope: 'private',
          },
        });

      case 'tools/call': {
        const name = (body?.params?.name ??
          req.headers.get('Mcp-Name') ??
          req.headers.get('mcp-name')) as ToolName;
        const args = body?.params?.arguments ?? {};

        if (!name || !TOOL_NAMES.includes(name)) {
          return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
        }

        const auth = await assertAgentRequest(getSupabase(), {
          rawKey: extractBearer(req),
          body: args,
          toolName: name,
        });

        const result = await dispatchTool(name, args, auth);
        return Response.json({ jsonrpc: '2.0', id, result });
      }

      default:
        return jsonRpcError(
          id,
          -32601,
          `Unknown Mcp-Method: ${method ?? '(missing)'}`
        );
    }
  } catch (e) {
    if (e instanceof DomainError) {
      return Response.json(
        {
          jsonrpc: '2.0',
          id,
          error: {
            code: mapDomainToJsonRpc(e.code),
            message: e.message,
            data: e.toJSON().error,
          },
        },
        { status: 200 }
      );
    }
    console.error(e);
    return jsonRpcError(id, -32603, 'Internal error');
  }
}

async function dispatchTool(
  name: ToolName,
  args: Record<string, unknown>,
  auth: Awaited<ReturnType<typeof assertAgentRequest>>
): Promise<unknown> {
  const supabase = getSupabase();
  const base = {
    workspaceId: auth.workspaceId,
    agentName: auth.agentName,
    key: auth,
  };

  switch (name) {
    case 'create_task':
      return createTask(
        {
          ...base,
          title: String(args.title ?? ''),
          description: args.description as string | undefined,
          column: args.column as any,
          assignee: args.assignee as string | undefined,
          tags: args.tags as string[] | undefined,
          deadline: args.deadline as string | undefined,
          priority: args.priority as any,
          complexity: args.complexity as any,
          blocked_by: args.blocked_by as string | undefined,
        },
        { supabase, wouldCreateCycle }
      );

    case 'move_task':
      return moveTask(
        {
          ...base,
          task_id: String(args.task_id ?? ''),
          target_column: args.target_column as any,
          version: Number(args.version),
          reason: args.reason as string | undefined,
          claim: Boolean(args.claim),
        },
        { supabase, resolveAgentWorkerId }
      );

    case 'get_workspace_settings':
    case 'get_tasks_by_column':
    case 'get_task_context':
    case 'handoff_task':
    case 'escalate_task':
    case 'send_message_to_chat':
    case 'undo':
      return {
        success: false,
        error: {
          code: 500,
          type: 'internal_error',
          message: `Tool '${name}' domain wiring pending — implement lib/domain/agent/${name}.ts`,
        },
      };

    default:
      return {
        success: false,
        error: {
          code: 400,
          type: 'invalid_params',
          message: `Unknown tool ${name}`,
        },
      };
  }
}

function mapDomainToJsonRpc(httpCode: number): number {
  if (httpCode === 401) return -32001;
  if (httpCode === 403) return -32003;
  if (httpCode === 404) return -32004;
  if (httpCode === 409) return -32009;
  if (httpCode === 422) return -32022;
  if (httpCode === 429) return -32029;
  if (httpCode >= 400 && httpCode < 500) return -32602;
  return -32603;
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } });
}

function descriptionFor(name: ToolName): string {
  const map: Record<ToolName, string> = {
    get_workspace_settings: 'Workspace settings and agent active tasks',
    get_tasks_by_column: 'List tasks in a column (Smart Backlog supported)',
    get_task_context: 'Full task context for session resume',
    create_task: 'Create a task (optional blocked_by)',
    move_task: 'Move task between columns (version required)',
    handoff_task: 'Hand off task to another agent',
    escalate_task: 'Escalate task to human',
    send_message_to_chat: 'Send Telegram message',
    undo: 'Undo own recent agent event (5 min window)',
  };
  return map[name];
}

function requiredFor(name: ToolName): string[] {
  const base = ['agent_name'];
  switch (name) {
    case 'create_task':
      return [...base, 'title'];
    case 'move_task':
      return [...base, 'task_id', 'target_column', 'version'];
    case 'get_tasks_by_column':
      return [...base, 'column'];
    case 'get_task_context':
    case 'escalate_task':
      return [...base, 'task_id'];
    case 'handoff_task':
      return [...base, 'task_id', 'target_agent', 'handoff_notes'];
    case 'send_message_to_chat':
      return [...base, 'chat_id', 'text'];
    case 'undo':
      return [...base, 'event_id'];
    default:
      return base;
  }
}

function schemaPropsFor(name: ToolName): Record<string, unknown> {
  switch (name) {
    case 'create_task':
      return {
        title: { type: 'string' },
        description: { type: 'string' },
        column: { type: 'string', enum: ['backlog', 'in_progress', 'review'] },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
        },
        complexity: { type: 'integer', enum: [1, 2, 3] },
        blocked_by: { type: 'string', format: 'uuid' },
      };
    case 'move_task':
      return {
        task_id: { type: 'string', format: 'uuid' },
        target_column: {
          type: 'string',
          enum: ['backlog', 'in_progress', 'review', 'done'],
        },
        version: { type: 'integer' },
        reason: { type: 'string' },
        claim: { type: 'boolean' },
      };
    default:
      return {};
  }
}
