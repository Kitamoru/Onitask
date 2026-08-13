// MCP Authentication & Authorization Layer (v0.7.0)
// Implements: timingSafeEqual (A-2), Tenant Isolation (A-7), Allowed Tools, Atomic Quota (A-3)

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Constants
// ============================================================================

export const MCP_API_KEY_HEADER = 'Authorization';
export const BEARER_PREFIX = 'Bearer ';
export const QUOTA_COST_MUTATION = 1;
export const QUOTA_COST_LIGHT_MESSAGE = 1; // send_message_to_chat uses separate light limit
export const DEFAULT_MAX_TASKS_PER_MINUTE = 50;

// ============================================================================
// Timing-Safe Comparison (INV-06, A-2)
// ============================================================================

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false immediately if lengths differ, but otherwise iterates all chars.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// Types
// ============================================================================

export interface McpKeyConfig {
  allowed_tools: string[] | 'all';
  can_send_messages: boolean;
  max_tasks_per_minute?: number;
}

export interface McpPermissions {
  allowed_tools: string[] | 'all';
  can_send_messages: boolean;
  max_tasks_per_minute: number;
}

export interface McpAuthResult {
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  permissions?: McpPermissions;
  agentWorkerId?: string;
  workspaceId?: string;
}

export type McpToolName =
  | 'get_tasks_by_column'
  | 'get_workspace_settings'
  | 'get_task_context'
  | 'create_task'
  | 'move_task'
  | 'escalate_task'
  | 'handoff_task'
  | 'send_message_to_chat'
  | 'undo';

// ============================================================================
// Key Parsing
// ============================================================================

/**
 * Extract API key from Authorization header value.
 * Expected format: "Bearer <key>"
 */
export function extractApiKey(headerValue: string): string | null {
  if (!headerValue || !headerValue.startsWith(BEARER_PREFIX)) {
    return null;
  }
  return headerValue.slice(BEARER_PREFIX.length).trim();
}

// ============================================================================
// Permissions Resolution
// ============================================================================

/**
 * Resolve MCP permissions for a given key hash and workspace settings.
 * 
 * Legacy mode: if mcp_api_keys is empty {} or key not found → allow all tools.
 * This ensures backward compatibility with existing integrations (Cursor, Claude Code).
 */
export function resolveMcpPermissions(
  keyHash: string,
  mcpApiKeys: Record<string, McpKeyConfig>
): McpPermissions {
  // Legacy mode: empty object or key not found → all tools allowed
  if (!mcpApiKeys || Object.keys(mcpApiKeys).length === 0 || !(keyHash in mcpApiKeys)) {
    return {
      allowed_tools: 'all',
      can_send_messages: true,
      max_tasks_per_minute: DEFAULT_MAX_TASKS_PER_MINUTE,
    };
  }

  const keyConfig = mcpApiKeys[keyHash];
  return {
    allowed_tools: keyConfig.allowed_tools ?? 'all',
    can_send_messages: keyConfig.can_send_messages ?? true,
    max_tasks_per_minute: keyConfig.max_tasks_per_minute ?? DEFAULT_MAX_TASKS_PER_MINUTE,
  };
}

/**
 * Check if a tool is allowed for the given permissions.
 */
export function isToolAllowed(toolName: McpToolName, permissions: McpPermissions): boolean {
  if (permissions.allowed_tools === 'all') return true;
  return Array.isArray(permissions.allowed_tools) && permissions.allowed_tools.includes(toolName);
}

/**
 * Check if sending messages is allowed.
 */
export function canSendMessage(permissions: McpPermissions): boolean {
  return permissions.can_send_messages;
}

// ============================================================================
// Tenant Isolation
// ============================================================================

/**
 * Verify that the requested workspace_id matches the one associated with the API key.
 * In legacy mode (no key config), tenant isolation is relaxed (backward compatible).
 * In secured mode, mismatched workspace_id → 403 forbidden.
 */
export function checkTenantIsolation(
  requestedWorkspaceId: string,
  keyAssociatedWorkspaceId: string | null,
  isSecuredMode: boolean
): boolean {
  // Legacy mode: no workspace binding → allow any workspace
  if (!isSecuredMode || !keyAssociatedWorkspaceId) return true;
  // Secured mode: workspace must match
  return requestedWorkspaceId === keyAssociatedWorkspaceId;
}

// ============================================================================
// Rate Limiting (per agent per workspace)
// ============================================================================

interface RateLimitWindow {
  startTime: number;
  count: number;
}

const rateLimitCache = new Map<string, RateLimitWindow>();

/**
 * Check rate limit for task creation.
 * Returns { allowed: true } or { allowed: false, retryAfterMs }.
 */
export function checkTaskCreationRateLimit(
  agentName: string,
  workspaceId: string,
  maxPerMinute: number
): { allowed: boolean; retryAfterMs?: number } {
  const cacheKey = `${workspaceId}:${agentName}`;
  const now = Date.now();
  const windowMs = 60_000; // 60 seconds rolling window

  const existing = rateLimitCache.get(cacheKey);
  if (!existing || now - existing.startTime >= windowMs) {
    // New window
    rateLimitCache.set(cacheKey, { startTime: now, count: 1 });
    return { allowed: true };
  }

  if (existing.count >= maxPerMinute) {
    const retryAfterMs = windowMs - (now - existing.startTime);
    return { allowed: false, retryAfterMs };
  }

  existing.count++;
  return { allowed: true };
}

/**
 * Clear expired rate limit entries (call periodically, e.g., every minute).
 */
export function clearExpiredRateLimitEntries(): void {
  const now = Date.now();
  for (const [key, window] of rateLimitCache.entries()) {
    if (now - window.startTime >= 60_000) {
      rateLimitCache.delete(key);
    }
  }
}

// ============================================================================
// Supabase Client Helper
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceRoleKey) {
    throw new Error('MCP auth requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, serviceRoleKey);
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Fetch workspace settings including mcp_api_keys by workspace_id.
 * Used to resolve permissions for a given key hash.
 */
export async function fetchWorkspaceSettings(
  workspaceId: string
): Promise<{
  mcp_api_keys: Record<string, McpKeyConfig>;
  quota_config: Record<string, unknown>;
} | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('workspace_settings')
      .select('mcp_api_keys, quota_config')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      mcp_api_keys: (data.mcp_api_keys as Record<string, McpKeyConfig>) ?? {},
      quota_config: (data.quota_config as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Atomically check and decrement AI quota via RPC.
 * Returns { success: true } or { success: false, error: 'quota_exceeded' }.
 */
export async function checkAndDecrementQuota(
  workspaceId: string,
  agentName: string,
  cost: number = QUOTA_COST_MUTATION
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('check_and_decrement_quota', {
      p_workspace_id: workspaceId,
      p_agent_name: agentName,
      p_cost: cost,
    });

    if (error) {
      console.error('Quota RPC error:', error);
      return { success: false, error: 'quota_check_failed' };
    }

    // RPC returns false when quota exceeded
    if (data === false) {
      return { success: false, error: 'quota_exceeded' };
    }

    return { success: true };
  } catch (err) {
    console.error('Quota RPC exception:', err);
    return { success: false, error: 'quota_check_failed' };
  }
}

/**
 * Fetch agent worker ID by agent_name and workspace_id.
 * Creates worker automatically via trg_auto_create_agent_worker if needed.
 */
export async function resolveAgentWorkerId(
  agentName: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', agentName)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

/**
 * Log an event to agent_events table.
 * Used for Memento pattern (state_before) and audit trail.
 */
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

/**
 * Get recent agent events for a task (last 20, ordered by created_at DESC).
 * Used by get_task_context.
 */
export async function getAgentEventsForTask(
  workspaceId: string,
  taskId: string
): Promise<Array<{
  tool: string;
  agent_name: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}>> {
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
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Get column history for a task from task_column_history.
 */
export async function getTaskColumnHistory(
  workspaceId: string,
  taskId: string
): Promise<Array<{
  from_column: string | null;
  to_column: string;
  moved_by: string | null;
  moved_at: string;
  metadata: Record<string, unknown> | null;
}>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('task_column_history')
      .select('from_column, to_column, moved_by, moved_at, metadata')
      .eq('workspace_id', workspaceId)
      .eq('task_id', taskId)
      .order('moved_at', { ascending: false });

    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Get task subgraph (task_relations edges) via RPC.
 * Returns null if no edges exist (not an error).
 */
export async function getTaskSubgraph(
  workspaceId: string,
  taskId: string
): Promise<Array<{
  from_task_id: string;
  to_task_id: string;
  relation_type: string;
  weight: number;
  depth: number;
}> | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_task_subgraph', {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });

    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a task exists in the workspace and return its details.
 */
export async function getTaskById(
  workspaceId: string,
  taskId: string
): Promise<{
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
} | null> {
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
 * Detect circular dependency via DFS before creating blocked_by edge.
 * Returns true if adding the edge would create a cycle.
 */
export async function detectCircularDependency(
  workspaceId: string,
  fromTaskId: string,
  toTaskId: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    
    // Use RPC to check for cycles
    const { data, error } = await supabase.rpc('detect_dependency_cycle', {
      p_workspace_id: workspaceId,
      p_from_task_id: fromTaskId,
      p_to_task_id: toTaskId,
    });

    if (error) return false; // Assume no cycle on error (fail open)
    return data ?? false;
  } catch {
    return false;
  }
}

// ============================================================================
// Middleware Entry Point
// ============================================================================

/**
 * Main MCP authentication middleware function.
 * Called by Next.js Route Handlers before processing the request body.
 * 
 * @param headersObj - Headers object from Next.js Request (Record<string, string>)
 * @param requestBody - Parsed request body (for workspace_id extraction)
 * @returns McpAuthResult with permissions or error details
 */
export async function mcpAuthMiddleware(
  headersObj: Record<string, string>,
  requestBody: { workspace_id?: string; agent_name?: string }
): Promise<McpAuthResult> {
  const { workspace_id, agent_name } = requestBody;

  // 1. Extract API key from Authorization header
  const authHeader = headersObj[MCP_API_KEY_HEADER.toLowerCase()] || headersObj['authorization'];
  if (!authHeader) {
    return {
      success: false,
      errorType: 'unauthorized',
      errorMessage: 'API key missing. Provide Authorization: Bearer <key>.',
    };
  }

  const rawKey = extractApiKey(authHeader);
  if (!rawKey) {
    return {
      success: false,
      errorType: 'unauthorized',
      errorMessage: 'Invalid Authorization header format. Expected: Bearer <key>.',
    };
  }

  // 2. Hash the key for storage lookup (SHA-256)
  const keyHash = await hashApiKey(rawKey);
  if (!keyHash) {
    return {
      success: false,
      errorType: 'unauthorized',
      errorMessage: 'Key hashing failed.',
    };
  }

  // 3. Validate key against workspace settings
  if (!workspace_id) {
    return {
      success: false,
      errorType: 'invalid_params',
      errorMessage: 'workspace_id is required.',
    };
  }

  const settings = await fetchWorkspaceSettings(workspace_id);
  if (!settings) {
    return {
      success: false,
      errorType: 'workspace_not_found',
      errorMessage: `Workspace ${workspace_id} not found.`,
    };
  }

  const { mcp_api_keys } = settings;
  const isSecuredMode = Object.keys(mcp_api_keys).length > 0;

  // 4. Verify key exists (in secured mode)
  if (isSecuredMode && !(keyHash in mcp_api_keys)) {
    return {
      success: false,
      errorType: 'unauthorized',
      errorMessage: 'API key not recognized for this workspace.',
    };
  }

  // 5. Resolve permissions
  const permissions = resolveMcpPermissions(keyHash, mcp_api_keys);

  // 6. Tenant isolation check
  if (!checkTenantIsolation(workspace_id, workspace_id, isSecuredMode)) {
    return {
      success: false,
      errorType: 'forbidden',
      errorMessage: 'workspace_id does not match the API key\'s workspace.',
    };
  }

  // 7. Resolve agent worker ID
  const agentWorkerId = await resolveAgentWorkerId(agent_name || 'anonymous', workspace_id);

  return {
    success: true,
    permissions,
    agentWorkerId: agentWorkerId ?? undefined,
    workspaceId: workspace_id,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Hash API key using SHA-256 for secure storage/lookup.
 * Returns hex string or null on failure.
 */
async function hashApiKey(key: string): Promise<string | null> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Sanitize HTML for Telegram message output.
 * Whitelist: <b>, <i>, <u>, <s>, <code>, <pre>.
 * Removes all <a href> tags and attributes to prevent phishing.
 */
export function sanitizeOutput(text: string, format: 'tg' | 'html'): string {
  if (format !== 'tg') return text;

  // Simple whitelist-based sanitization for Telegram
  // Remove <a href="..."> tags entirely (prevent phishing links)
  let sanitized = text.replace(/<a\s+href="[^"]*"[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/a>/gi, '');

  // Keep only allowed tags: b, i, u, s, code, pre
  const allowedTags = ['b', 'i', 'u', 's', 'code', 'pre'];
  for (const tag of allowedTags) {
    // Allow self-closing and standard tags
    sanitized = sanitized.replace(new RegExp(`<(?!/${tag}\\b)(/${tag})\\b[^>]*>`, 'gi'), '');
  }

  // Truncate to 4096 characters (Telegram limit)
  if (sanitized.length > 4096) {
    sanitized = sanitized.slice(0, 4096);
  }

  return sanitized;
}