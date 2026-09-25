export type EscalationReason =
  | 'insufficient_context'
  | 'conflicting_requirements'
  | 'blocked_by'
  | 'out_of_scope'
  | 'max_attempts'
  | 'unsupported_task'
  | (string & {})
  | null;

export interface EscalationQueueItem {
  id: string;
  workspace_id: string;
  workspace_name: string;
  full_id: string;
  title: string;
  agent_name: string | null;
  reason: EscalationReason;
  reason_label: string;
  summary: string;
  suggested_action: string | null;
  nack_reason: string | null;
  nack_detail: string | null;
  moved_to_column_at: string | null;
  hours_pending: number;
  column: string;
  is_blocked: boolean;
  can_retry: boolean;
}

export interface EscalationsResponse {
  items: EscalationQueueItem[];
}

export interface RetryEscalationResponse {
  success: true;
  task_id: string;
  needs_human: false;
  escalation_reason: null;
  is_blocked: boolean;
  version: number;
  updated_at: string;
  retry_started: boolean;
  dispatch_created: boolean;
  already_resolved: boolean;
}
