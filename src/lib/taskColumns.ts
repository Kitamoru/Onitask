export type TaskColumn = 'backlog' | 'in_progress' | 'review' | 'done';

export interface TaskColumnMeta {
  label: string;
  accent: string;
}

export const TASK_COLUMN_ORDER: readonly TaskColumn[] = [
  'backlog',
  'in_progress',
  'review',
  'done',
] as const;

export const TASK_COLUMN_META: Record<TaskColumn, TaskColumnMeta> = {
  backlog: {
    label: 'В очереди',
    accent: 'var(--color-text-primary)',
  },
  in_progress: {
    label: 'В работе',
    accent: 'var(--color-accent-amber)',
  },
  review: {
    label: 'На проверке',
    accent: 'var(--color-signal-cyan)',
  },
  done: {
    label: 'Сделано',
    accent: 'var(--color-signal-green)',
  },
};

export function taskColumnLabel(column: string | null | undefined): string {
  if (!column) return '—';
  return TASK_COLUMN_META[column as TaskColumn]?.label ?? column;
}

export function taskColumnAccent(column: string | null | undefined): string {
  if (!column) return 'var(--color-text-secondary)';
  return TASK_COLUMN_META[column as TaskColumn]?.accent ?? 'var(--color-text-secondary)';
}
