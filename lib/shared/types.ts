// lib/shared/types.ts
// Domain types for the agent surface per MCP Contract v0.8.0 §4.
// workspace_id is always resolved from the key (AgentKeyContext), never trusted from body.

import type { AgentKeyContext } from './mcpAuth';

// ============================================================================
// Common
// ============================================================================

export type TaskColumn = 'backlog' | 'in_progress' | 'review' | 'done';

export interface TaskPreview {
  id: string;
  title: string;
  column: string;
  assigned_to: string | null;
  reviewer_id: string | null;
  version: number;
  is_inbox: boolean;
  is_blocked: boolean;
  full_id: string;
  task_number: number;
  blocking_value?: number;
  /**
   * Migration 051: reason of the last review→in_progress return.
   * Same value as tasks.metadata.last_fix_reason (read path only).
   */
  fix_reason?: string;
}

/**
 * Every domain service receives the resolved auth context
 * (workspace from key, agent_name validated) plus its tool-specific params.
 */
export interface DomainContext {
  key: AgentKeyContext;
  agentName: string;
}

export type DomainResult<T> =
  | ({ success: true } & T)
  | { success: false; error: { code: number; type: string; message: string } };

// ============================================================================
// get_tasks_by_column (§4.1)
// ============================================================================

export interface GetTasksByColumnParams extends DomainContext {
  column?: TaskColumn;
  limit?: number; // default 20, max 50
  assigned_to_me?: boolean;
  sort_by_blocking_value?: boolean; // only column='backlog'
}

export interface GetTasksByColumnResult {
  tasks: TaskPreview[];
}

// ============================================================================
// get_workspace_settings (§4.2)
// ============================================================================

export interface GetWorkspaceSettingsParams extends DomainContext {}

export interface WorkspaceSettingsPayload {
  enable_cognitive_budget: boolean;
  story_points_config: Record<string, unknown>;
  velocity_window_days: number;
  flow_config: Record<string, unknown>;
  realtime_subscription_level: 'own_tasks' | 'all';
  workspace_context: string | null;
  workspace_context_cache: string | null;
  context_stale: boolean;
  doc_kb_config: Record<string, unknown> | null;
  agent_active_tasks: TaskPreview[] | null;
}

export interface GetWorkspaceSettingsResult {
  settings: WorkspaceSettingsPayload;
}

// ============================================================================
// create_task (§4.3)
// ============================================================================

export interface CreateTaskParams extends DomainContext {
  title: string;
  description?: string;
  column?: 'backlog' | 'in_progress' | 'review';
  assignee?: string;
  tags?: string[];
  deadline?: string; // ISO 8601
  priority?: 'low' | 'medium' | 'high' | 'critical';
  complexity?: 1 | 2 | 3;
  blocked_by?: string; // UUID of blocker
}

export interface CreateTaskResult {
  task: {
    task_id: string;
    task_number: number;
    full_id: string;
    title: string;
    column: string;
    created_at: string;
    version: number;
    relation_created: boolean;
  };
}

// ============================================================================
// move_task (§4.4)
// ============================================================================

export interface MoveTaskParams extends DomainContext {
  task_id: string;
  target_column: TaskColumn;
  version: number; // REQUIRED (v0.8.0 breaking)
  reason?: string;
  claim?: boolean;
}

export interface MoveTaskResult {
  task_id: string;
  new_column: string;
  claimed: boolean;
  version: number;
  moved_at: string;
  unblocked_ids: string[];
}

// ============================================================================
// escalate_task (§4.5)
// ============================================================================

export type EscalationReason =
  | 'insufficient_context'
  | 'conflicting_requirements'
  | 'blocked_by'
  | 'out_of_scope';

export interface EscalateTaskParams extends DomainContext {
  task_id: string;
  reason: EscalationReason;
  suggested_action?: string;
}

export interface EscalateTaskResult {
  task_id: string;
}

// ============================================================================
// send_message_to_chat (§4.6)
// ============================================================================

export interface SendMessageAttachmentInput {
  filename: string;
  content_base64: string;
  caption?: string;
}

export interface SendMessageToChatParams extends DomainContext {
  chat_id: number;
  text: string; // max 4096
  parse_mode?: 'HTML' | 'MarkdownV2';
  /** FILE-03: UUID связанной задачи — добавляет инлайн-кнопку «Обсудить задачу» */
  task_id?: string;
  /** FILE-03: файлы агента (максимум 5, ≤2MB base64 на файл, ≤3MB суммарно) */
  attachments?: SendMessageAttachmentInput[];
}

export interface SendMessageToChatResult {
  message_id: number;
}

// ============================================================================
// get_task_context (§4.7)
// ============================================================================

export interface GetTaskContextParams extends DomainContext {
  task_id: string;
  /**
   * CTX-02: default true. workspace_context is static per workspace — omit on
   * per-task calls and fetch it once at session start to keep payloads small.
   */
  include_workspace_context?: boolean;
  /**
   * CTX-02: default true. memory_summary rarely changes mid-session — omit on
   * per-task calls and fetch it once at session start.
   */
  include_memory_summary?: boolean;
  /** CTX-02: cap on returned agent_events. Default 20, max 20. */
  events_limit?: number;
  /** FILE-06: default false. Load task attachments (metadata + signed URLs) when true. */
  include_attachments?: boolean;
}

export interface SubgraphEdge {
  from_task_id: string;
  to_task_id: string;
  relation_type: 'blocks' | 'spawned_from' | 'mentions';
  weight: number; // 1.0 | 0.8 | 0.3
  depth: 1 | 2;
}

export interface GetTaskContextResult {
  task: {
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
  };
  column_history: Array<{
    from_column: string | null;
    to_column: string;
    moved_by: string | null;
    moved_at: string;
    metadata: Record<string, unknown> | null;
  }>;
  agent_events: Array<{
    tool: string;
    agent_name: string;
    summary: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  memory_summary: string | null;
  workspace_context: string | null;
  relevant_docs: Array<{
    filename: string;
    section: string;
    content: string;
    similarity: number;
  }> | null;
  /** FILE-06: attachments (metadata + signed URL), null when include_attachments=false */
  attachments: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    url: string | null;
    created_at: string;
  }> | null;
  subgraph: SubgraphEdge[] | null;
}

// ============================================================================
// get_task_comments (FILE-08)
// ============================================================================

export interface GetTaskCommentsParams extends DomainContext {
  task_id: string;
  /** keyset-пагинация фида (ниже курсора) */
  cursor_created?: string;
  cursor_id?: string;
  /** default 30, max 100 */
  limit?: number;
}

export interface GetTaskCommentsResult {
  items: Array<{
    item_id: string;
    kind: 'comment' | 'status' | 'agent';
    author_id: string | null;
    author_name: string;
    author_type: 'human' | 'agent' | 'system';
    body: string | null;
    created_at: string;
    edited_at: string | null;
    payload: Record<string, unknown> | null;
  }>;
}

// ============================================================================
// handoff_task (§4.8)
// ============================================================================

export interface HandoffTaskParams extends DomainContext {
  task_id: string;
  target_agent: string;
  handoff_notes: string; // required, max 1000
  move_to_column?: string;
}

export interface HandoffTaskResult {
  task_id: string;
  handed_off_to: string;
  new_column: string | null;
  version: number;
}

// ============================================================================
// undo (§4.9)
// ============================================================================

export interface UndoParams extends DomainContext {
  event_id: string;
}

export interface UndoResult {
  restored: boolean;
}