'use client';

/**
 * SubtaskViewSheet — сокращённая карточка подзадачи (SUB-01).
 *
 * Подзадача = строка `tasks`, поэтому у неё есть колонка, срок и исполнитель,
 * и человек ожидает увидеть то же, что у обычной задачи. Но полная форма
 * TaskViewEdit здесь лишняя: спринта, story points и когнитивного веса у
 * подзадачи нет по замыслу (см. `docs/TASKS.md` SUB-01).
 *
 * Отдельная сущность со своим UI-контрактом потребовала бы второй формы
 * редактирования, второго набора прав и второй синхронизации. Вместо этого
 * переиспользуем куски общей формы: те же WorkerSelectSheet, SingleDateSheet
 * и patchTask, что у родителя.
 */

import { useState } from 'react';
import { ArrowUpRight, Calendar, Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card, SectionHeader } from '@/components/ui/desk-ui';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import ParticipantCard from '@/components/flowboard/ParticipantCard';
import { WorkerSelectSheet } from '@/components/flowboard/WorkerSelectSheet';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { SUBTASK_STATE_LABEL, subtaskState } from '@/lib/subtasks';

export interface SubtaskViewSheetProps {
  open: boolean;
  onClose: () => void;
  subtask: TaskEntity;
  /** Исполнитель подзадачи для ParticipantCard. */
  assignee: WorkerCardData | null;
  /** Участники воркспейса; в выборе показываются только активные люди. */
  workers: WorkerCardData[];
  /** Права на родителе: без canEdit карточка read-only. */
  canEdit: boolean;
  /** Отправляет PATCH подзадачи; возвращает текст ошибки или null при успехе. */
  onPatch: (
    subtaskId: string,
    payload: Record<string, unknown>,
  ) => Promise<string | null>;
}


export function SubtaskViewSheet({
  open,
  onClose,
  subtask,
  assignee,
  workers,
  canEdit,
  onPatch,
}: SubtaskViewSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);

  const state = subtaskState({ column: subtask.column, deadline: subtask.deadline });

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const failure = await onPatch(subtask.id, payload);
    setBusy(false);
    if (failure) setError(failure);
  };

  // Агент-исполнитель запрещён для подзадач (SUB-01, v1), поэтому в списке
  // выбора его нет: показать и тут же отклонить — лишний шаг до ошибки.
  // Проверку is_active опускаем намеренно — /api/flow/metrics отдаёт только
  // активных, а сервер всё равно перепроверяет canBeSubtaskAssignee.
  const humanWorkers = workers.filter((w) => w.type === 'human');

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6">
        <div>
          <span className="text-[13px] font-medium text-text-muted">
            Подзадача {subtask.subtask_index} · {subtask.full_id}
          </span>
          <h2 className="mt-1 text-[19px] font-medium text-text">{subtask.title}</h2>
        </div>

        {subtask.description && (
          <p className="text-[14px] leading-relaxed text-text-secondary">
            {subtask.description}
          </p>
        )}

        <SectionHeader title="Состояние" />
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-text">
                {SUBTASK_STATE_LABEL[state]}
              </span>
              {subtask.deadline && (
                <span className="flex items-center gap-1.5 text-[13px] text-text-muted">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(subtask.deadline).toLocaleDateString('ru-RU')}
                </span>
              )}
            </div>
            {assignee ? (
              <ParticipantCard
                id={assignee.id}
                displayName={assignee.displayName}
                avatarUrl={assignee.avatarUrl}
                role="Исполнитель"
              />
            ) : (
              <p className="text-sm text-text-secondary">Без исполнителя</p>
            )}
          </div>
        </Card>

        {canEdit && (
          <>
            <SectionHeader title="Действия" />
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setAssigneeOpen(true)}
                className="w-full"
              >
                {assignee ? 'Сменить исполнителя' : 'Назначить исполнителя'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeadlineOpen(true)}
                className="w-full"
              >
                {subtask.deadline ? 'Изменить срок' : 'Задать срок'}
              </Button>
              {/* Перенос в самостоятельные задачи. subtask_index обнуляем
                  обязательно: сервер считает max+1 по оставшимся подзадачам
                  родителя, и старый номер образовал бы дыру в нумерации. */}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run({ parent_task_id: null, subtask_index: null })
                }
                className="w-full"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <ArrowUpRight className="h-4 w-4" />
                  Сделать самостоятельной задачей
                </span>
              </Button>
            </div>
          </>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Сохранение…
          </div>
        )}

        {error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}

        <WorkerSelectSheet
          open={assigneeOpen}
          onClose={() => setAssigneeOpen(false)}
          workers={humanWorkers}
          selectedId={subtask.assigned_to}
          title="Исполнитель подзадачи"
          onSelect={(id) => void run({ assigned_to: id })}
        />

        <SingleDateSheet
          open={deadlineOpen}
          onClose={() => setDeadlineOpen(false)}
          date={subtask.deadline ? new Date(subtask.deadline) : null}
          onConfirm={(date) => void run({ deadline: date.toISOString() })}
        />
      </div>
    </BottomSheet>
  );
}
