'use client';

/**
 * Общие мутации подзадачи (PATCH / DELETE).
 *
 * Живут в хуке, потому что шторка подзадачи монтируется в двух местах:
 * внутри `SubtasksSection` (тап по строке в карточке родителя) и на уровне
 * страницы (тап по подзадаче в стриме). Если бы обработчики остались в секции,
 * правка из стрима инвалидировала бы query-кэш `['task-subtasks', …]` задачи,
 * которой на экране нет, — и список не обновился бы.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteTask, patchTask } from '@/lib/api/flow';

export interface SubtaskMutations {
  /** PATCH подзадачи; возвращает текст ошибки или null при успехе. */
  patchSubtask: (
    subtaskId: string,
    payload: Record<string, unknown>,
  ) => Promise<string | null>;
  /** Удаление подзадачи; возвращает текст ошибки или null при успехе. */
  deleteSubtask: (subtaskId: string) => Promise<string | null>;
  /** Идёт удаление — для блокировки кнопок. */
  isDeleting: boolean;
}

export function useSubtaskMutations(
  parentTaskId: string | null | undefined,
  /** Ошибки удаления, возникшие мимо шторки, уходят сюда. */
  onErrorChange?: (message: string | null) => void,
): SubtaskMutations {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['task-subtasks', parentTaskId] as const,
    [parentTaskId],
  );

  // Подзадача удаляется общим DELETE /api/tasks/[id]: это та же строка tasks,
  // отдельный эндпоинт на удаление завёл бы второй путь каскада (вложения,
  // комментарии, коммит-история) — ровно то, чего SUB-01 избегает.
  const deleteMutation = useMutation({
    mutationFn: async (subtaskId: string) => {
      const { success, error } = await deleteTask(subtaskId);
      if (!success) throw new Error(error ?? 'Не удалось удалить подзадачу');
    },
    onSuccess: () => {
      onErrorChange?.(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      onErrorChange?.(
        err instanceof Error ? err.message : 'Не удалось удалить подзадачу',
      ),
  });

  /**
   * PATCH идёт общим patchTask: подзадача — строка tasks, отдельного эндпоинта
   * на редактирование заводить незачем. invalidate нужен, чтобы список
   * перечитал колонку, срок и текст после смены.
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

  const deleteSubtask = useCallback(
    async (subtaskId: string): Promise<string | null> => {
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

  return {
    patchSubtask,
    deleteSubtask,
    isDeleting: deleteMutation.isPending,
  };
}