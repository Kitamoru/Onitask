// lib/shared/mcpAuth.ts
// Auth foundation for the agent surface (MCP Contract v0.8.0 §2.3–2.4).
// Backing store: mcp_agent_keys (Master Spec §6.19).
// Guarantees: A-2 (timing-safe key handling), A-7 (tenant isolation from key),
// INV-04 (agent worker auto-create via DB trigger), A-3 (atomic quota via RPC).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DomainError,
  unauthorized,
  forbidden,
  toolNotPermitted,
  invalidParams,
} from './errors';

// ============================================================================
// Constants
// ============================================================================

export const BEARER_PREFIX = 'Bearer ';
export const QUOTA_COST_MUTATION = 1;
export const DEFAULT_MAX_TASKS_PER_MINUTE = 50;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

export type McpToolName =
  | 'get_tasks_by_column'
  | 'get_workspace_settings'
  | 'get_task_context'
  | 'get_task_comments'
  | 'create_task'
  | 'move_task'
  | 'escalate_task'
  | 'handoff_task'
  | 'send_message_to_chat'
  | 'undo';

// ============================================================================
// Supabase client (service role — API layer only, never client-side)
// ============================================================================

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Agent surface requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

// ============================================================================
// Key hashing (sha256 hex)
// ============================================================================

export async function sha256(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// allowed_tools normalization (TECH_SOLUTION §2)
// ============================================================================

export function normalizeAllowedTools(raw: unknown): 'all' | string[] {
  if (raw === 'all' || raw === '"all"') return 'all';
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

export function isToolAllowed(tool: string, allowed: 'all' | string[]): boolean {
  if (allowed === 'all') return true;
  return allowed.includes(tool);
}

// ============================================================================
// resolveAgentKey — workspace_id resolves FROM the key (contract §2.3)
// ============================================================================

export interface AgentKeyContext {
  workspaceId: string;
  allowedTools: 'all' | string[];
  canSendMessages: boolean;
  maxTasksPerMinute: number;
  keyHash: string;
  /**
   * Arch 0.9 ADR R2 (migration 061): canonical agent identity bound to the
   * key (1 key = 1 agent). Ops surface resolves identity from this field;
   * client-provided agent_name may only assert-match it (mismatch → 403).
   */
  keyAgentName: string;
}

export async function resolveAgentKey(rawKey: string): Promise<AgentKeyContext> {
  const keyHash = await sha256(rawKey);
  const supabase = getSupabaseClient();

  const { data: key, error } = await supabase
    .from('mcp_agent_keys')
    .select(
      'workspace_id, agent_name, allowed_tools, can_send_messages, max_tasks_per_minute'
    )
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !key) {
    throw unauthorized('API key not recognized or revoked.');
  }

  // fire-and-forget last_used_at update
  void supabase
    .from('mcp_agent_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash);

  return {
    workspaceId: key.workspace_id as string,
    allowedTools: normalizeAllowedTools(key.allowed_tools),
    canSendMessages: key.can_send_messages as boolean,
    maxTasksPerMinute:
      (key.max_tasks_per_minute as number) ?? DEFAULT_MAX_TASKS_PER_MINUTE,
    keyHash,
    keyAgentName: key.agent_name as string,
  };
}

// ============================================================================
// assertAgentRequest — the 4 security checks (contract §2.4) in one place
// ============================================================================

export interface AgentRequestContext extends AgentKeyContext {
  agentName: string;
}

export async function assertAgentRequest(opts: {
  rawKey: string | null;
  body: { workspace_id?: string; agent_name?: string };
  toolName: string;
}): Promise<AgentRequestContext> {
  // 1. timingSafeEqual-backed key resolution (A-2) — unknown/revoked → 401
  if (!opts.rawKey) {
    throw unauthorized('Provide Authorization: Bearer <key>.');
  }
  const key = await resolveAgentKey(opts.rawKey);

  // 2. Tenant isolation (A-7) — optional workspace_id must match key scope
  if (
    opts.body.workspace_id !== undefined &&
    opts.body.workspace_id !== null &&
    opts.body.workspace_id !== key.workspaceId
  ) {
    throw forbidden('workspace_id does not match the API key scope.');
  }

  // 3. Agent identity — agent_name REQUIRED, no default (contract §2.4.3)
  if (!opts.body.agent_name || typeof opts.body.agent_name !== 'string') {
    throw invalidParams('agent_name is required.');
  }

  // 4. Allowed tools
  if (!isToolAllowed(opts.toolName, key.allowedTools)) {
    throw toolNotPermitted(opts.toolName);
  }

  return { ...key, agentName: opts.body.agent_name };
}

/**
 * Extract Bearer key from a Headers instance.
 */
export function bearerFromHeaders(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (!auth || !auth.startsWith(BEARER_PREFIX)) return null;
  const raw = auth.slice(BEARER_PREFIX.length).trim();
  return raw.length > 0 ? raw : null;
}

// ============================================================================
// Rate limit — Postgres count over agent_events (no Redis, contract §10)
// ============================================================================

export async function checkTaskCreationRateLimit(
  workspaceId: string,
  agentName: string,
  maxPerMinute: number
): Promise<void> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('agent_events')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('agent_name', agentName)
    .eq('tool', 'create_task')
    .gte(
      'created_at',
      new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
    );

  if (error) {
    // Fail open on infra error — quota RPC still gates mutations.
    console.error('Rate limit count error:', error);
    return;
  }

  if ((count ?? 0) >= maxPerMinute) {
    throw new DomainError(
      429,
      'task_creation_rate_limit',
      `Rate limit exceeded: max ${maxPerMinute} tasks/min per agent. Retry after 60s.`
    );
  }
}

// ============================================================================
// Atomic quota (A-3) — RPC check_and_decrement_quota returns jsonb
// ============================================================================

export async function checkAndDecrementQuota(
  workspaceId: string,
  agentName: string,
  cost: number = QUOTA_COST_MUTATION
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('check_and_decrement_quota', {
    p_workspace_id: workspaceId,
    p_agent_name: agentName,
    p_cost: cost,
  });

  if (error) {
    console.error('Quota RPC error:', error);
    throw new DomainError(500, 'internal_error', 'Quota check failed.');
  }

  // RPC returns jsonb: { success: boolean, remaining, max, used }
  if (data && typeof data === 'object' && data.success === false) {
    throw new DomainError(
      422,
      'quota_exceeded',
      'AI mutation quota exhausted. Use send_message_to_chat (separate light limit) or wait for quota reset.'
    );
  }
}

// ============================================================================
// Shared DB helpers (moved from legacy lib/mcpAuth.ts)
// ============================================================================

/**
 * Find-or-create the agent worker for this identity (INV-04, app-level).
 *
 * Since migration 052 the DB trigger auto_create_agent_worker is gone:
 * creation happens ONLY here — on an authenticated MCP-key call path — so
 * pseudo-agent audit names (e.g. 'telegram_user_<tg_id>' written by the bot
 * webhook) can never materialize as assignable board workers.
 */
export async function resolveAgentWorkerId(
  agentName: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    // Agent workers use prefixed source_id per Master Spec §6.2 ('agent::<name>')
    const sourceId = `agent::${agentName}`;

    const { data: existing, error: selErr } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', sourceId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (selErr) {
      console.error('resolveAgentWorkerId select error:', selErr);
      return null;
    }
    if (existing) return existing.id as string;

    // Zero-config onboarding (INV-04): the first authenticated action of a new
    // agent materializes its worker. ignoreDuplicates keeps this concurrent-
    // safe; the re-select below covers the race where a parallel request won.
    const { error: insErr } = await supabase.from('workers').upsert(
      {
        workspace_id: workspaceId,
        type: 'agent',
        display_name: agentName,
        source_id: sourceId,
      },
      { onConflict: 'workspace_id,source_id', ignoreDuplicates: true }
    );
    if (insErr) {
      console.error('resolveAgentWorkerId upsert error:', insErr);
      return null;
    }

    const { data: created } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', sourceId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    return (created?.id as string) ?? null;
  } catch (err) {
    console.error('resolveAgentWorkerId failed:', err);
    return null;
  }
}

export async function logAgentEvent(
  workspaceId: string,
  agentName: string,
  tool: string,
  taskId: string | null,
  summary: string | null,
  metadata: Record<string, unknown> | null,
  stateBefore: Record<string, unknown> | null
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('agent_events').insert({
      workspace_id: workspaceId,
      agent_name: agentName,
      tool,
      task_id: taskId,
      summary,
      metadata,
      state_before: stateBefore,
    });
  } catch (err) {
    console.error('Failed to log agent event:', err);
  }
}

export async function getAgentEventsForTask(
  workspaceId: string,
  taskId: string
): Promise<
  Array<{
    tool: string;
    agent_name: string;
    summary: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>
> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('agent_events')
      .select('tool, agent_name, summary, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return [];
    return (data ?? []) as Array<{
      tool: string;
      agent_name: string;
      summary: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>;
  } catch {
    return [];
  }
}

export async function getTaskColumnHistory(
  workspaceId: string,
  taskId: string
): Promise<
  Array<{
    from_column: string | null;
    to_column: string;
    moved_by: string | null;
    moved_at: string;
    metadata: Record<string, unknown> | null;
  }>
> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('task_column_history')
      .select('from_column, to_column, moved_by, moved_at, metadata')
      .eq('workspace_id', workspaceId)
      .eq('task_id', taskId)
      .order('moved_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as Array<{
      from_column: string | null;
      to_column: string;
      moved_by: string | null;
      moved_at: string;
      metadata: Record<string, unknown> | null;
    }>;
  } catch {
    return [];
  }
}

export async function getTaskSubgraph(
  workspaceId: string,
  taskId: string
): Promise<
  Array<{
    from_task_id: string;
    to_task_id: string;
    relation_type: string;
    weight: number;
    depth: number;
  }> | null
> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_task_subgraph', {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });
    if (error) return null;
    return (data ?? null) as Array<{
      from_task_id: string;
      to_task_id: string;
      relation_type: string;
      weight: number;
      depth: number;
    }> | null;
  } catch {
    return null;
  }
}

export async function getTaskById(workspaceId: string, taskId: string) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', taskId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * DFS cycle check via RPC detect_circular_dependency (migration 024).
 * For create_task the new task has no outgoing edges yet, so a cycle is
 * structurally impossible — the check is kept for contract uniformity
 * (TECH_SOLUTION §3.3) and runs BEFORE any INSERT.
 */
export async function detectCircularDependency(
  workspaceId: string,
  fromTaskId: string,
  toTaskId: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('detect_circular_dependency', {
      p_workspace_id: workspaceId,
      p_from_task_id: fromTaskId,
      p_to_task_id: toTaskId,
    });
    if (error) return false; // fail open — INSERT-time triggers still guard
    return (data as boolean) ?? false;
  } catch {
    return false;
  }
}

// ============================================================================
// Telegram HTML sanitization (security §4.1)
// ============================================================================

export function sanitizeOutput(text: string, format: 'tg' | 'html'): string {
  if (format !== 'tg') return text;

  // Remove <a href> tags entirely (prevent phishing links)
  let sanitized = text.replace(/<a\s+href="[^"]*"[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/a>/gi, '');

  // Strip attributes from allowed tags: b, i, u, s, code, pre
  const allowedTags = ['b', 'i', 'u', 's', 'code', 'pre'];
  for (const tag of allowedTags) {
    sanitized = sanitized.replace(
      new RegExp(`<${tag}\\b[^>]*>`, 'gi'),
      `<${tag}>`
    );
  }

  // Remove any remaining tags not in the whitelist
  sanitized = sanitized.replace(/<\/?(?!(?:\/)?(?:b|i|u|s|code|pre)\b)[^>]*>/gi, '');

  // Telegram hard limit
  if (sanitized.length > 4096) {
    sanitized = sanitized.slice(0, 4096);
  }

  return sanitized;
}

// ============================================================================
// Server-side complexity inference (F-04 server fill, contract §4.3)
// ============================================================================

export function inferComplexity(description?: string): 1 | 2 | 3 {
  if (!description) return 1;
  const lower = description.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('error'))
    return 1;
  if (
    lower.includes('feature') ||
    lower.includes('implement') ||
    lower.includes('add')
  )
    return 2;
  return 3;
}

// Re-export for transports that need to map DomainError → HTTP/JSON-RPC
export { DomainError, invalidParams };