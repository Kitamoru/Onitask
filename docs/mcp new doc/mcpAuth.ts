/**
 * MCP / Agent API auth — mcp_contract v0.8.0 §2.3–2.4
 * Backing store: mcp_agent_keys (Master §6.19)
 */

import { createHash, timingSafeEqual } from 'crypto';
import { errors } from './errors';

type Supabase = { from: (table: string) => any };

export type AgentKeyContext = {
  workspaceId: string;
  allowedTools: 'all' | string[];
  canSendMessages: boolean;
  maxTasksPerMinute: number;
  keyHash: string;
};

export function sha256(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function normalizeAllowedTools(raw: unknown): 'all' | string[] {
  if (raw === 'all') return 'all';
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === 'all') return 'all';
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      /* fallthrough */
    }
    return 'all';
  }
  if (Array.isArray(raw)) return raw as string[];
  return 'all';
}

export function isToolAllowed(
  toolName: string,
  allowedTools: 'all' | string[]
): boolean {
  if (allowedTools === 'all') return true;
  return allowedTools.includes(toolName);
}

export async function resolveAgentKey(
  supabase: Supabase,
  rawKey: string
): Promise<AgentKeyContext> {
  const keyHash = sha256(rawKey);

  const { data: key, error } = await supabase
    .from('mcp_agent_keys')
    .select(
      'workspace_id, allowed_tools, can_send_messages, max_tasks_per_minute, key_hash'
    )
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !key) throw errors.unauthorized();

  const stored = Buffer.from(String(key.key_hash), 'utf8');
  const computed = Buffer.from(keyHash, 'utf8');
  if (
    stored.length !== computed.length ||
    !timingSafeEqual(stored, computed)
  ) {
    throw errors.unauthorized();
  }

  void supabase
    .from('mcp_agent_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash);

  return {
    workspaceId: key.workspace_id,
    allowedTools: normalizeAllowedTools(key.allowed_tools),
    canSendMessages: Boolean(key.can_send_messages),
    maxTasksPerMinute: Number(key.max_tasks_per_minute ?? 50),
    keyHash,
  };
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export async function assertAgentRequest(
  supabase: Supabase,
  opts: {
    rawKey: string | null;
    body: { workspace_id?: string; agent_name?: string };
    toolName: string;
  }
): Promise<AgentKeyContext & { agentName: string }> {
  if (!opts.rawKey) throw errors.unauthorized();

  const ctx = await resolveAgentKey(supabase, opts.rawKey);

  if (
    opts.body.workspace_id != null &&
    opts.body.workspace_id !== ctx.workspaceId
  ) {
    throw errors.forbidden();
  }

  const agentName = opts.body.agent_name?.trim();
  if (!agentName) {
    throw errors.invalidParams('agent_name is required.');
  }

  if (!isToolAllowed(opts.toolName, ctx.allowedTools)) {
    throw errors.toolNotPermitted(opts.toolName);
  }

  if (opts.toolName === 'send_message_to_chat' && !ctx.canSendMessages) {
    throw errors.toolNotPermitted(opts.toolName);
  }

  return { ...ctx, agentName };
}
