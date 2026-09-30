'use client';

/**
 * SubtasksSection — блок подзадач в карточке задачи (SUB-01).
 *
 * Заменяет фиктивный тоггл «Чеклист задачи»: чеклист — список пунктов внутри
 * одной задачи, а подзадачи — отдельные задачи со своими сроками, исполнителями
 * и историей. Один контрол на оба смысла был бы ложью в интерфейсе.
 *
 * Данные берём отдельным запросом `/api/tasks/[id]/subtasks`, а не из общего
 * стора: подзадачи исключены из выдачи Flow Board (миграции 140/141), и в
 * `availableTasks` их просто нет.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CountBadge,
  NotchedPanel,
  SectionHeader,
  ToggleSwitch,
} from '@/components/ui/desk-ui';
import { createSubtask, getSubtasks } from '@/lib/api/subtasks';
import { deleteTask, patchTask } from '@/lib/api/flow';
import { MAX_SUBTASKS, SUBTASK_STATE_LABEL, subtaskState } from '@/lib/subtasks';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { SubtaskViewSheet } from './SubtaskViewSheet';

export interface SubtasksSectionProps {
  task: TaskEntity;
  /** Участники доски — для выбора исполнителя новой подзадачи. */
  workers: WorkerCardData[];
  /** Права на родителе: без canEdit секция read-only. */
  canEdit: boolean;
  /**
   * Право удалять подзадачу. Отдельно от canEdit: по правилам сервера удаляет
   * автор родителя или админ, а править может ещё и исполнитель. Смешивать их
   * нельзя — иначе кнопка предлагала бы действие, которое сервер отвергнет 403.
   */
  canDeleteSubtask: boolean;
  /** Deep link из TG: подзадача, которую раскрыть и подсветить. */
  highlightSubtaskId?: string | null;
}

export function SubtasksSection({
  task,
  workers,
  canEdit,
  canDeleteSubtask,
  highlightSubtaskId = null,
}: SubtasksSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['task-subtasks', task.id] as const, [task.id]);
  const [enabled, setEnabled] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [openSubtask, setOpenSubtask] = useState<TaskEntity | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const subtasksQuery = useQuery({
    queryKey,
    queryFn: () => getSubtasks(task.id),
    enabled: enabled && !!task.id,
    staleTime: 15_000,
  });

  const subtasks = subtasksQuery.data?.subtasks ?? [];
  const limitReached = subtasks.length >= MAX_SUBTASKS;

  const createMutation = useMutation({
    mutationFn: (title: string) => createSubtask(task.id, { title }),
    onSuccess: () => {
      setDraft('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : 'Не удалось создать подзадачу'),
  });

  // Подзадача удаляется общим DELETE /api/tasks/[id]: это та же строка tasks,
  // отдельный эндпоинт на удаление завёл бы второй путь каскада (вложения,
  // комментарии, коммит-история) — ровно то, чего SUB-01 избегает.
  const deleteMutation = useMutation({
    mutationFn: async (subtaskId: string) => {
      const { success, error } = await deleteTask(subtaskId);
      if (!success) throw new Error(error ?? 'Не удалось удалить подзадачу');
    },
    onSuccess: () => {
      setConfirmDeleteId(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : 'Не удалось удалить подзадачу'),
  });

  /**
   * PATCH подзадачи идёт общим patchTask: подзадача — строка tasks, отдельный
   * эндпоинт на редактирование заводить незачем. invalidate нужен, чтобы список
   * перечитал колонку и срок после смены.
   */
  const patchSubtask = useCallback(
    async (subtaskId: string, payload: Record<string, unknown>) => {
      const { warning } = await patchTask(subtaskId, payload as never);
      if (warning) return warning;
      await queryClient.invalidateQueries({ queryKey });
      return null;
    },
    [queryClient, queryKey],
  );

  const handleCreate = () => {
    const title = draft.trim();
    if (!title) return;
    setActionError(null);
    void createMutation.mutateAsync(title).catch(() => {
      // Текст ошибки уже разобран в onError.
    });
  };

  const handleDelete = (subtaskId: string) => {
    setActionError(null);
    void deleteMutation.mutateAsync(subtaskId).catch(() => {
      // Текст ошибки уже разобран в onError.
    });
  };

  return (
    <section>
      <SectionHeader title="Подзадачи" />
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[15px] font-medium text-text">
              Подзадачи
              {subtasks.length > 0 && <CountBadge>{subtasks.length}</CountBadge>}
            </span>
            <ToggleSwitch
              checked={enabled}
              onChange={setEnabled}
              label="Подзадачи"
              disabled={!canEdit}
            />
          </div>
        </Card>

        {enabled && (
          <>
            {subtasksQuery.isPending && (
              <div className="flex items-center gap-2 py-2 text-[13px] text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка подзадач…
              </div>
            )}

            {subtasks.length > 0 && (
              <div className="flex flex-col gap-2">
                {subtasks.map((subtask) => {
                  const state = subtaskState({
                    column: subtask.column,
                    deadline: subtask.deadline,
                  });
                  const isHighlighted = highlightSubtaskId === subtask.id;
                  return (
                    <div key={subtask.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenSubtask(subtask)}
                        // Подсветка deep link'а: amber-рамка, тот же акцент, что у
                        // результата подзадачи в ленте (ADR-2026-09-30).
                        className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
                          isHighlighted
                            ? 'border-[var(--color-accent-amber)]'
                            : 'border-line'
                        }`}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[12px] font-semibold text-text-muted">
                          {subtask.subtask_index}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[14px] ${
                            state === 'done'
                              ? 'text-text-muted line-through'
                              : 'text-text'
                          }`}
                        >
                          {subtask.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-text-muted">
                          {SUBTASK_STATE_LABEL[state]}
                        </span>
                      </button>
                      {canDeleteSubtask &&
                        (confirmDeleteId === subtask.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="solid"
                              onClick={() => handleDelete(subtask.id)}
                              disabled={deleteMutation.isPending}
                              aria-label="Подтвердить удаление подзадачи"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setConfirmDeleteId(null)}
                              aria-label="Отменить удаление"
                            >
                              Отмена
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            onClick={() => setConfirmDeleteId(subtask.id)}
                            aria-label={`Удалить подзадачу ${subtask.subtask_index}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <NotchedPanel
                corner="field"
                notch={8}
                contentClassName="flex flex-col gap-3 px-4 py-3"
              >
                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !limitReached) handleCreate();
                    }}
                    placeholder={
                      limitReached
                        ? `Лимит — ${MAX_SUBTASKS} подзадач`
                        : 'Что нужно сделать?'
                    }
                    disabled={limitReached || createMutation.isPending}
                    className="w-full bg-transparent text-[15px] text-text outline-none placeholder:text-text-muted"
                  />
                  <Button
                    variant="solid"
                    onClick={handleCreate}
                    disabled={
                      limitReached ||
                      createMutation.isPending ||
                      draft.trim().length === 0
                    }
                    className="w-full"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Добавить подзадачу
                  </Button>
                </div>
              </NotchedPanel>
            )}

            {actionError && (
              <p className="text-[13px] text-[var(--color-danger)]">{actionError}</p>
            )}
          </>
        )}
      </div>

      {openSubtask && (
        <SubtaskViewSheet
          open
          onClose={() => setOpenSubtask(null)}
          subtask={openSubtask}
          assignee={workers.find((w) => w.id === openSubtask.assigned_to) ?? null}
          workers={workers}
          canEdit={canEdit}
          onPatch={patchSubtask}
        />
      )}
    </section>
  );
}
