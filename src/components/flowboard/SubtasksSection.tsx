'use client';

/**
 * SubtasksSection — блок подзадач в карточке задачи (SUB-01).
 *
 * Заменяет фиктивный тоггл «Чеклист задачи»: чеклист — список пунктов внутри
 * одной задачи, а подзадачи — отдельные задачи со своими сроками,
 * исполнителями и историей. Смешивать их в одном контроле было бы ложью в UI.
 *
 * Раскладка (решение владельца, 2026-09-30): ОДИН заголовок «Подзадачи» и
 * ОДИН блок под ним — список плюс кнопка «Добавить подзадачу». Отдельного
 * заголовка, тоггла и поля ввода в блоке нет: ввод переехал в
 * SubtaskCreateSheet, который открывается по кнопке.
 *
 * В режиме просмотра пустой блок не показывается вовсе — заголовок без
 * содержимого только шумит.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  NotchedPanel,
  SectionHeader,
} from '@/components/ui/desk-ui';
import { createSubtask, getSubtasks } from '@/lib/api/subtasks';
import { deleteTask, patchTask } from '@/lib/api/flow';
import { MAX_SUBTASKS, subtaskState } from '@/lib/subtasks';
import { taskColumnLabel } from '@/lib/taskColumns';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { SubtaskViewSheet } from './SubtaskViewSheet';
import { SubtaskCreateSheet } from './SubtaskCreateSheet';

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
  /** Режим просмотра: в нём пустой блок подзадач не показывается. */
  isView: boolean;
  /** Текущий пользователь — правило ревью при переносе подзадачи в «Сделано». */
  currentUserId: string | null | undefined;
  currentUserRole: string | null | undefined;
  /** Deep link из TG: подзадача, которую раскрыть и подсветить. */
  highlightSubtaskId?: string | null;
}

export function SubtasksSection({
  task,
  workers,
  canEdit,
  canDeleteSubtask,
  isView,
  currentUserId,
  currentUserRole,
  highlightSubtaskId = null,
}: SubtasksSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['task-subtasks', task.id] as const, [task.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [openSubtask, setOpenSubtask] = useState<TaskEntity | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const subtasksQuery = useQuery({
    queryKey,
    queryFn: () => getSubtasks(task.id),
    enabled: !!task.id,
    staleTime: 15_000,
  });

  const subtasks = subtasksQuery.data?.subtasks ?? [];
  const limitReached = subtasks.length >= MAX_SUBTASKS;

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
      setActionError(
        err instanceof Error ? err.message : 'Не удалось удалить подзадачу',
      ),
  });

  /**
   * PATCH подзадачи идёт общим patchTask: подзадача — строка tasks, отдельного
   * эндпоинта на редактирование заводить незачем. invalidate нужен, чтобы список
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

  const handleCreate = async (input: {
    title: string;
    description?: string | null;
    assigned_to?: string | null;
    deadline?: string | null;
  }) => {
    setActionError(null);
    try {
      await createSubtask(task.id, input);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Не удалось создать подзадачу';
    }
  };

  const handleDelete = (subtaskId: string) => {
    setActionError(null);
    void deleteMutation.mutateAsync(subtaskId).catch(() => {
      // Текст ошибки уже разобран в onError.
    });
  };

  /**
   * Удаление из шторки подзадачи. Тот же мутатор, что и кнопка в списке, но
   * возвращает текст ошибки вызывающему — шторка показывает его сам.
   */
  const deleteSubtask = useCallback(
    async (subtaskId: string): Promise<string | null> => {
      setActionError(null);
      try {
        await deleteMutation.mutateAsync(subtaskId);
        return null;
      } catch (err) {
        return err instanceof Error
          ? err.message
          : 'Не удалось удалить подзадачу';
      }
    },
    [deleteMutation],
  );

  // Пустой блок в режиме просмотра не показываем: смотреть не на что, а
  // заголовок «Подзадачи» без содержимого только занимает место.
  const hideEmptyBlock =
    isView && subtasks.length === 0 && !subtasksQuery.isPending && !subtasksQuery.isError;
  if (hideEmptyBlock) return null;

  return (
    <section>
      <SectionHeader title="Подзадачи" />
      <Card notch={8}>
        <div className="flex flex-col gap-4">
          {subtasksQuery.isPending && (
            <div className="flex items-center gap-2 py-2 text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка подзадач…
            </div>
          )}

          {subtasksQuery.isError && (
            <div
              className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]"
              role="alert"
            >
              {subtasksQuery.error.message}
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
                    <NotchedPanel
                      corner="field"
                      notch={4}
                      fill="var(--color-surface)"
                      className="min-w-0 flex-1"
                      contentClassName="flex items-center gap-3 p-3"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenSubtask(subtask)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        aria-label={`Открыть подзадачу ${subtask.full_id}`}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            {/* Подсветка deep link'а — тот же amber, что у
                                результата подзадачи в ленте. */}
                            <span
                              className={`font-mono text-[11px] ${
                                isHighlighted
                                  ? 'text-[var(--color-accent-amber)]'
                                  : 'text-text-muted'
                              }`}
                            >
                              {subtask.full_id}
                            </span>
                            <span className="text-[11px] text-text-muted">
                              {/* Колонка, а не состояние: «Просрочена» — это
                                  вычисляемое состояние поверх due_date, и в
                                  строке списка оно шумит. Тот же словарь, что
                                  у связанных задач. */}
                              · {taskColumnLabel(subtask.column)}
                            </span>
                          </div>
                          <span
                            className={`truncate text-[14px] font-medium ${
                              state === 'done' ? 'text-text-muted line-through' : 'text-text'
                            }`}
                          >
                            {subtask.title}
                          </span>
                        </div>
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
                    </NotchedPanel>
                  </div>
                );
              })}
            </div>
          )}

          {actionError && (
            <div
              className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]"
              role="alert"
            >
              {actionError}
            </div>
          )}

          {canEdit && (
            // Зелёный градиент — тот же приём, что у кнопки «Редактировать»
            // в TaskViewEdit (borderGradient grad-add-from/to на corner=action).
            <NotchedPanel
              corner="action"
              notch={8}
              borderWidth={1.5}
              borderGradient={[
                'var(--color-grad-add-from)',
                'var(--color-grad-add-to)',
              ]}
              fill="var(--color-bg)"
              className="h-10 w-full"
              contentClassName="h-full w-full"
            >
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                disabled={limitReached}
                aria-label={limitReached ? `Лимит подзадач — ${MAX_SUBTASKS}` : 'Добавить подзадачу'}
                className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-text disabled:opacity-40"
              >
                Добавить подзадачу
              </button>
            </NotchedPanel>
          )}
        </div>
      </Card>

      {createOpen && (
        <SubtaskCreateSheet
          open
          onClose={() => setCreateOpen(false)}
          workers={workers}
          onCreate={handleCreate}
        />
      )}

      {openSubtask && (
        <SubtaskViewSheet
          open
          onClose={() => setOpenSubtask(null)}
          subtask={openSubtask}
          parent={task}
          assignee={workers.find((w) => w.id === openSubtask.assigned_to) ?? null}
          workers={workers}
          canEdit={canEdit}
          canDelete={canDeleteSubtask}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onPatch={patchSubtask}
          onDelete={deleteSubtask}
        />
      )}
    </section>
  );
}
