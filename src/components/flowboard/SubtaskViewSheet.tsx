'use client';

/**
 * SubtaskViewSheet — шторка подзадачи (SUB-01).
 *
 * Раскладка задана владельцем (2026-09-30):
 *   · заголовок «Подзадача PREFIX-N-SUB-i»;
 *   · «Контекст» — описание материнской задачи;
 *   · «Подзадача» — текст, написанный в «Что нужно сделать» при создании;
 *   · дедлайн.
 *
 * Контекст родителя не украшение: подзадача без него висит в Telegram и в ленте
 * как «ONI-42-SUB-3», и человек не понимает, частью чего она является.
 *
 * Два режима, как у самой задачи (TaskViewEdit):
 *   · просмотр — текст, срок, исполнитель и действия «Переместить» /
 *     «Редактировать»;
 *   · редактирование — правка текста, исполнителя и срока одним «Сохранить».
 *
 * Содержание лежит в `description`, а `title` — производная короткая метка для
 * списка, поиска и Telegram. Отдельного `subtask_description` нет намеренно:
 * `trg_invalidate_task_embedding` обнуляет вектор по title/description, и второе
 * поле сюда бы не попало — тихая рассинхронизация поиска (ADR-2026-10-02).
 * Поэтому сохранение пишет оба поля, а показываем `description || title`.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Loader2, Pencil, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card, SectionHeader, TextArea } from '@/components/ui/desk-ui';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import ParticipantCard from '@/components/flowboard/ParticipantCard';
import { WorkerSelectSheet } from '@/components/flowboard/WorkerSelectSheet';
import { MoveTaskSheet } from '@/components/flowboard/MoveTaskSheet';
import {
  isReviewBypassBlocked,
  REVIEW_BYPASS_BLOCKED,
} from '@/lib/reviewDecision';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';

export interface SubtaskViewSheetProps {
  open: boolean;
  onClose: () => void;
  subtask: TaskEntity;
  /** Задача-родитель: отдаёт описание для блока «Контекст». */
  parent: TaskEntity;
  /** Исполнитель подзадачи для ParticipantCard. */
  assignee: WorkerCardData | null;
  /** Участники доски; в выборе показываются только активные люди. */
  workers: WorkerCardData[];
  canEdit: boolean;
  /**
   * Право удалять подзадачу. Отдельно от canEdit: править может и исполнитель,
   * а удалять — только автор родителя или админ. Одно поле на оба действия
   * обещало бы кнопку, которую сервер отвергнет 403.
   */
  canDelete: boolean;
  /** Текущий пользователь — для правила ревью при переносе в «Сделано». */
  currentUserId: string | null | undefined;
  currentUserRole: string | null | undefined;
  /** PATCH подзадачи; возвращает текст ошибки или null при успехе. */
  onPatch: (
    subtaskId: string,
    payload: Record<string, unknown>,
  ) => Promise<string | null>;
  /** Удаление подзадачи; возвращает текст ошибки или null при успехе. */
  onDelete: (subtaskId: string) => Promise<string | null>;
}

type Mode = 'view' | 'edit';

interface Draft {
  text: string;
  assignedTo: string | null;
  deadline: string | null;
}

export function SubtaskViewSheet({
  open,
  onClose,
  subtask,
  parent,
  assignee,
  workers,
  canEdit,
  canDelete,
  currentUserId,
  currentUserRole,
  onPatch,
  onDelete,
}: SubtaskViewSheetProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveColumn, setMoveColumn] = useState(subtask.column);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    text: '',
    assignedTo: null,
    deadline: null,
  });

  // Агент-исполнитель запрещён для подзадач (SUB-01, v1), поэтому в списке
  // выбора его нет: показать и тут же отклонить — лишний шаг до ошибки.
  const humanWorkers = workers.filter((w) => w.type === 'human');

  // Текст подзадачи — то, что ввели в «Что нужно сделать». description полнее
  // обрезанного до 500 символов title, но у старых строк его может не быть.
  const subtaskText = subtask.description?.trim() || subtask.title;
  const parentText = parent.description?.trim() || '';

  // REV-02: подзадача наследует reviewer_id родителя, поэтому перенос в
  // «Сделано» блокируется тем же предикатом, что и у задачи. Иначе кнопка
  // обещала бы перенос, который Route Handler отвергнет.
  const doneColumnBlocked = isReviewBypassBlocked(
    { reviewer_id: subtask.reviewer_id ?? null },
    { workerId: currentUserId, role: currentUserRole },
  );

  const startEdit = () => {
    setError(null);
    setDraft({
      text: subtaskText,
      assignedTo: subtask.assigned_to ?? null,
      deadline: subtask.deadline ?? null,
    });
    setMode('edit');
  };

  const cancelEdit = () => {
    setError(null);
    setMode('view');
  };

  const runPatch = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const failure = await onPatch(subtask.id, payload);
    setBusy(false);
    if (failure) setError(failure);
  };

  const handleSave = async () => {
    const text = draft.text.trim();
    if (!text) {
      setError('Текст подзадачи не может быть пустым');
      return;
    }
    setBusy(true);
    setError(null);
    // Пишем оба поля: description — источник текста, title — короткая метка
    // для списка и поиска. title ограничен сервером 500 символами.
    const failure = await onPatch(subtask.id, {
      description: text,
      title: text.slice(0, 500),
      assigned_to: draft.assignedTo,
      deadline: draft.deadline,
    });
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setMode('view');
  };

  const handleMoveConfirm = (targetColumn: string) => {
    void runPatch({ column: targetColumn });
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    const failure = await onDelete(subtask.id);
    setDeleting(false);
    if (failure) {
      setError(failure);
      return;
    }
    setConfirmDelete(false);
    onClose();
  };

  // Модалка подтверждения — портал в body: у BottomSheet свой transform
  // контекст, и вложенная модалка оказалась бы под ним. Тот же приём, что
  // в TaskViewEdit.
  const deleteConfirmModal =
    confirmDelete &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center px-4 pb-6 sm:items-center sm:pb-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        onClick={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-subtask-title"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6"
          style={{ backgroundColor: '#1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="delete-subtask-title"
            className="mb-2 text-center text-lg font-semibold"
            style={{ color: '#FAFAFA' }}
          >
            Удалить подзадачу?
          </p>
          <p className="mb-6 text-center text-sm" style={{ color: '#8B8B8B' }}>
            Подзадача и её комментарии будут удалены без возможности
            восстановления.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              onClick={() => void handleDelete()}
              disabled={deleting}
              fill="#EF4444"
              textColor="#FAFAFA"
            >
              {deleting ? 'Удаление...' : 'Удалить подзадачу'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              style={{ borderColor: '#333', color: '#8B8B8B' }}
            >
              Отмена
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  const draftAssignee =
    workers.find((w) => w.id === draft.assignedTo) ?? null;

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div className="flex flex-col gap-4 px-4 pb-6 pt-6">
          <div>
            <h2 className="text-[19px] font-medium text-text">
              Подзадача {subtask.full_id}
            </h2>
          </div>

          {parentText && (
            <>
              <SectionHeader title="Контекст" />
              <Card>
                <p className="text-[14px] leading-relaxed text-text-secondary">
                  {parentText}
                </p>
              </Card>
            </>
          )}

          {mode === 'view' ? (
            <>
              <SectionHeader title="Подзадача" />
              <Card>
                <p className="text-[14px] leading-relaxed text-text">
                  {subtaskText}
                </p>
              </Card>

              {subtask.deadline && (
                <div className="flex items-center gap-2 text-[14px] text-text">
                  <Calendar className="h-4 w-4 text-text-muted" />
                  {new Date(subtask.deadline).toLocaleDateString('ru-RU')}
                </div>
              )}

              {assignee && (
                <ParticipantCard
                  id={assignee.id}
                  displayName={assignee.displayName}
                  avatarUrl={assignee.avatarUrl}
                  role="Исполнитель"
                />
              )}

              {canEdit && (
                <>
                  <SectionHeader title="Действия" />
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setMoveColumn(subtask.column);
                        setMoveOpen(true);
                      }}
                      className="w-full"
                    >
                      Переместить
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={startEdit}
                      className="w-full"
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <Pencil className="h-4 w-4" />
                        Редактировать
                      </span>
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <SectionHeader title="Текст подзадачи" />
              <TextArea
                corner="field"
                value={draft.text}
                onChange={(value) =>
                  setDraft((d) => ({ ...d, text: value }))
                }
                placeholder="Что нужно сделать"
              />

              <SectionHeader title="Исполнитель и срок" />
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setAssigneeOpen(true)}
                  className="w-full"
                >
                  {draftAssignee
                    ? `Исполнитель: ${draftAssignee.displayName}`
                    : 'Назначить исполнителя'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeadlineOpen(true)}
                  className="w-full"
                >
                  {draft.deadline
                    ? `Срок: ${new Date(draft.deadline).toLocaleDateString('ru-RU')}`
                    : 'Задать срок'}
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="solid"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className="w-full"
                >
                  Сохранить
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={cancelEdit}
                  className="w-full"
                >
                  Отмена
                </Button>
                {canDelete && (
                  <Button
                    variant="outline"
                    disabled={busy || deleting}
                    onClick={() => setConfirmDelete(true)}
                    className="w-full"
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <Trash2 className="h-4 w-4" />
                      Удалить подзадачу
                    </span>
                  </Button>
                )}
              </div>
            </>
          )}

          {busy && (
            <div className="flex items-center gap-2 text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Сохранение…
            </div>
          )}

          {error && (
            <p className="text-[13px] text-[var(--color-priority-red-text)]">
              {error}
            </p>
          )}

          <WorkerSelectSheet
            open={assigneeOpen}
            onClose={() => setAssigneeOpen(false)}
            workers={humanWorkers}
            selectedId={draft.assignedTo}
            title="Исполнитель подзадачи"
            onSelect={(id) => {
              setAssigneeOpen(false);
              setDraft((d) => ({ ...d, assignedTo: id }));
            }}
          />

          <SingleDateSheet
            open={deadlineOpen}
            onClose={() => setDeadlineOpen(false)}
            date={draft.deadline ? new Date(draft.deadline) : null}
            onConfirm={(date) => {
              setDeadlineOpen(false);
              setDraft((d) => ({ ...d, deadline: date.toISOString() }));
            }}
          />
        </div>
      </BottomSheet>

      {/* Вне BottomSheet: MoveTaskSheet сам открывается поверх (stacked). */}
      {moveOpen && (
        <MoveTaskSheet
          open
          onClose={() => setMoveOpen(false)}
          task={{ full_id: subtask.full_id, title: subtaskText }}
          currentColumn={subtask.column}
          selectedColumn={moveColumn}
          onSelect={setMoveColumn}
          onConfirm={handleMoveConfirm}
          disabledColumns={doneColumnBlocked ? ['done'] : []}
          disabledReason={REVIEW_BYPASS_BLOCKED}
        />
      )}

      {deleteConfirmModal}
    </>
  );
}
