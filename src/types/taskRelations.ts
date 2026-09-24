import type { TaskColumn } from '@/lib/taskColumns';

export type TaskRelationDirection = 'blocked_by' | 'blocks';

export interface RelatedTaskSummary {
  id: string;
  full_id: string;
  title: string;
  column: TaskColumn;
  is_blocked: boolean;
}

export interface RelatedTaskItem {
  relation_id: string;
  direction: TaskRelationDirection;
  task: RelatedTaskSummary;
}

export interface TaskRelationsResponse {
  blockers: RelatedTaskItem[];
  downstream: RelatedTaskItem[];
}

export interface AffectedTaskState {
  id: string;
  is_blocked: boolean;
  version: number;
  updated_at: string;
}

export interface CreateTaskRelationResponse {
  relation_id: string;
  affected_task: AffectedTaskState;
}

export interface DeleteTaskRelationResponse {
  relation_id: string;
  affected_task: AffectedTaskState;
}
