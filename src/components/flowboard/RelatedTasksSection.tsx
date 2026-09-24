'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button, Card, NotchedPanel, SectionHeader } from '@/components/ui/desk-ui';
import { createTaskRelation, deleteTaskRelation, getTaskRelations } from '@/lib/api/taskRelations';
import { taskColumnLabel } from '@/lib/taskColumns';
import type { TaskEntity } from '@/types/flowboard';
import type { AffectedTaskState, RelatedTaskItem, TaskRelationDirection } from '@/types/taskRelations';
import { RelatedTaskPickerSheet } from './RelatedTaskPickerSheet';

export interface RelatedTasksSectionProps {
  task: TaskEntity;
  availableTasks: TaskEntity[];
  onOpenTask: (taskId: string) => void;
  onTaskStateChange: (state: AffectedTaskState) => void;
  /** Relations can be added/removed only while the task is being edited. */
  editable: boolean;
}

export function RelatedTasksSection({
  task,
  availableTasks,
  onOpenTask,
  onTaskStateChange,
  editable,
}: RelatedTasksSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['task-relations', task.id] as const, [task.id]);
  const [pickerDirection, setPickerDirection] = useState<TaskRelationDirection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const relationsQuery = useQuery({
    queryKey,
    queryFn: () => getTaskRelations(task.id),
    staleTime: 15_000,
  });

  const syncAffectedTask = (state: AffectedTaskState) => {
    onTaskStateChange(state);
    void queryClient.invalidateQueries({ queryKey });
  };
  const createMutation = useMutation({
    mutationFn: ({ relatedTaskId, direction }: { relatedTaskId: string; direction: TaskRelationDirection }) =>
      createTaskRelation(task.id, relatedTaskId, direction),
    onSuccess: (result) => syncAffectedTask(result.affected_task),
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Не удалось создать связь'),
  });
  const deleteMutation = useMutation({
    mutationFn: (relationId: string) => deleteTaskRelation(task.id, relationId),
    onSuccess: (result) => syncAffectedTask(result.affected_task),
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Не удалось удалить связь'),
  });

  const blockers = relationsQuery.data?.blockers ?? [];
  const downstream = relationsQuery.data?.downstream ?? [];
  const excludedTaskIds = useMemo(
    () => new Set([...blockers, ...downstream].map((item) => item.task.id)),
    [blockers, downstream],
  );
  const completedBlockers = blockers.filter((item) => item.task.column === 'done').length;
  const hasOrphanBlock = task.is_blocked && blockers.length > 0 && completedBlockers === blockers.length;
  const hasRelations = blockers.length > 0 || downstream.length > 0;
  const pendingAction = createMutation.isPending || deleteMutation.isPending;

  const handleCreate = async (related: TaskEntity) => {
    if (!pickerDirection) return;
    setActionError(null);
    await createMutation.mutateAsync({ relatedTaskId: related.id, direction: pickerDirection });
  };
  const handleDelete = async (item: RelatedTaskItem) => {
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(item.relation_id);
      setConfirmDeleteId(null);
    } catch {
      // React Query already exposes the error through actionError.
    }
  };

  const renderGroup = (title: string, items: RelatedTaskItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          {title} · {items.length}
        </span>
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const orphan = item.direction === 'blocked_by' && task.is_blocked && item.task.column === 'done';
            return (
              <NotchedPanel
                key={item.relation_id}
                corner="field"
                notch={4}
                fill={orphan ? 'rgba(239, 159, 39, 0.08)' : 'var(--color-surface)'}
                contentClassName="flex items-center gap-3 p-3"
              >
                <button
                  type="button"
                  onClick={() => onOpenTask(item.task.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-label={`Открыть ${item.task.full_id}: ${item.task.title}`}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-text-muted">{item.task.full_id}</span>
                      <span className="text-[11px] text-text-muted">· {taskColumnLabel(item.task.column)}</span>
                    </div>
                    <span className="truncate text-[14px] font-medium text-text">{item.task.title}</span>
                    {orphan && (
                      <span className="flex items-center gap-1 text-[11px] text-[var(--color-priority-amber-text)]">
                        <AlertTriangle className="h-3 w-3" /> Блокировка устарела
                      </span>
                    )}
                  </div>
                </button>
                {editable && (confirmDeleteId === item.relation_id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={pendingAction}
                      onClick={() => void handleDelete(item)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-[var(--color-priority-red-text)] disabled:opacity-40"
                    >
                      {deleteMutation.isPending && deleteMutation.variables === item.relation_id
                        ? 'Удаляем…'
                        : orphan ? 'Исправить' : 'Убрать'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded px-1 py-1 text-[11px] text-text-muted"
                      aria-label="Отменить удаление связи"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={pendingAction}
                    onClick={() => setConfirmDeleteId(item.relation_id)}
                    className="rounded p-2 text-text-muted transition-colors hover:text-[var(--color-priority-red-text)] disabled:opacity-40"
                    aria-label={orphan ? 'Исправить устаревшую блокировку' : 'Убрать связь'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ))}
              </NotchedPanel>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section>
      <SectionHeader title="Связанные задачи" />
      <Card notch={8}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            {blockers.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex justify-between text-[12px] text-text-secondary">
                  <span>Обязательные задачи</span>
                  <span>{completedBlockers} / {blockers.length} сделано</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[var(--color-signal-green)] transition-[width]"
                    style={{ width: `${Math.round((completedBlockers / blockers.length) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {relationsQuery.isPending ? (
            <div className="flex items-center gap-2 py-3 text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка связей…
            </div>
          ) : relationsQuery.isError ? (
            <div className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]" role="alert">
              {relationsQuery.error.message}
            </div>
          ) : hasRelations ? (
            <>
              {hasOrphanBlock && (
                <div className="flex gap-2 rounded border border-[var(--color-priority-amber-border)] bg-[rgba(239,159,39,0.08)] px-3 py-2 text-[12px] text-[var(--color-priority-amber-text)]">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Все обязательные задачи сделаны, но флаг блокировки не снят. Удалите связь рядом с устаревшей задачей.
                </div>
              )}
              {renderGroup('Ждёт завершения', blockers)}
              {renderGroup('После завершения этой задачи', downstream)}
              {downstream.length > 0 && (
                <p className="text-[12px] text-text-muted">
                  Завершение текущей задачи разблокирует {downstream.length}{' '}
                  {downstream.length === 1 ? 'задачу' : 'задачи'}.
                </p>
              )}
            </>
          ) : null}

          {actionError && (
            <div className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]" role="alert">
              {actionError}
            </div>
          )}

          {editable && task.column !== 'done' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="outline" onClick={() => setPickerDirection('blocked_by')} disabled={pendingAction}>
                Добавить блокер
              </Button>
              <Button variant="outline" onClick={() => setPickerDirection('blocks')} disabled={pendingAction}>
                Эта задача блокирует
              </Button>
            </div>
          )}
        </div>
      </Card>

      <RelatedTaskPickerSheet
        open={editable && pickerDirection !== null}
        onClose={() => setPickerDirection(null)}
        direction={pickerDirection ?? 'blocked_by'}
        currentTask={task}
        tasks={availableTasks}
        excludedTaskIds={excludedTaskIds}
        onSelect={handleCreate}
      />
    </section>
  );
}
