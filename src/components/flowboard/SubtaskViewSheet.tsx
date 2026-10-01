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

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card, NotchedPanel, SectionHeader, TextArea } from '@/components/ui/desk-ui';
import {
  ExternalLinksCard,
  type ExternalLink,
} from '@/components/desk-create/ExternalLinksCard';
import {
  getTaskAttachments,
  getLatestTaskSubmission,
  reviewTask,
  signTaskAttachment,
  type TaskAttachment,
} from '@/lib/api/flow';
import { formatBytes } from '@/lib/format';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import { SingleDateField } from '@/components/ui/SingleDateField';
import ParticipantCard from '@/components/flowboard/ParticipantCard';
import { WorkerSelectSheet } from '@/components/flowboard/WorkerSelectSheet';
import { ReviewDecisionBlock } from '@/components/flowboard/ReviewDecisionBlock';
import { MoveTaskSheet } from '@/components/flowboard/MoveTaskSheet';
import {
  isReviewBypassBlocked,
  REVIEW_BYPASS_BLOCKED,
} from '@/lib/reviewDecision';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';

export interface SubtaskViewSheetProps {
  open: boolean;
  onClose: () => void;
  subtask: TaskEntity | null;
  /**
   * Задача-родитель: отдаёт описание для блока «Контекст», ссылки и файлы.
   *
   * Nullable вместе с `subtask`: шторка смонтирована постоянно ради анимации
   * (см. useEffect на `open`), поэтому данные в закрытом виде — null.
   */
  parent: TaskEntity | null;
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
  /**
   * Тап по блоку «Контекст» открывает карточку материнской задачи. Шторка может
   * быть открыта сама по себе (тап по подзадаче в стриме), и без этого перехода
   * на родителя было бы вовсе недостижимо.
   */
  onOpenParent?: () => void;
  /**
   * SUB-01: переход вперёд в «На проверке» требует сдачи результата. Шторка
   * только перехватывает и просит; сама форма и её обработчик — на странице,
   * один инстанс на задачу и на подзадачу.
   */
  onRequestSubmit?: (
    subtaskId: string,
    targetColumn: 'review' | 'done',
  ) => void;
  /** Решение по ревью принято — пора обновить список подзадач. */
  onReviewResolved?: () => void;
}

type Mode = 'view' | 'edit';

/**
 * Заглушка для read-only карточек. `ExternalLinksCard` требует обработчики
 * по типам, но в readOnly-режиме они не вызываются — модульная константа, чтобы
 * не плодить новую функцию на каждом рендере.
 */
const noop = () => {};

/**
 * SUB-01: в «Сделано» подзадача попадает только через approve из формы ревью
 * (решение владельца, 2026-10-01). Короткого пути нет: без него слияние
 * результата с родителем (миг. 142) происходило бы мимо решения ревьюера.
 */
export const SUBTASK_DONE_REQUIRES_REVIEW =
  'Подзадача попадает в «Сделано» только после согласования на ревью';

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
  onOpenParent,
  onRequestSubmit,
  onReviewResolved,
}: SubtaskViewSheetProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveColumn, setMoveColumn] = useState(subtask?.column ?? 'backlog');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    text: '',
    assignedTo: null,
    deadline: null,
  });

  // Шторка смонтирована постоянно (иначе BottomSheet не успевает проиграть
  // переход open false→true и подзадача просто возникает). Раз монтирования
  // больше нет, состояние переживает закрытие — сбрасываем его явно, иначе
  // подзадача, открытая в режиме правки, таким режимом и откроется в следующий
  // раз. Размонтирование раньше делало это само.
  useEffect(() => {
    if (open) return;
    setMode('view');
    setError(null);
    setConfirmDelete(false);
    setMoveOpen(false);
    setAssigneeOpen(false);
    setDeadlineOpen(false);
  }, [open]);

  // Агент-исполнитель запрещён для подзадач (SUB-01, v1), поэтому в списке
  // выбора его нет: показать и тут же отклонить — лишний шаг до ошибки.
  const humanWorkers = workers.filter((w) => w.type === 'human');

  // Текст подзадачи — то, что ввели в «Что нужно сделать». description полнее
  // обрезанного до 500 символов title, но у старых строк его может не быть.
  const subtaskText = subtask?.description?.trim() || subtask?.title || '';
  const parentText = parent?.description?.trim() || '';

  // ─── Контекст из материнской задачи ───────────────────────────────────────
  // Ссылки лежат в metadata.external_links родителя — то же поле, что правит
  // карточка задачи. Отдельной сущности «ссылки подзадачи» не заводим.
  const parentLinks = (parent?.metadata?.external_links ?? []) as ExternalLink[];

  const parentFilesQuery = useQuery({
    queryKey: ['task-attachments', parent?.id],
    queryFn: () => getTaskAttachments(parent!.id),
    // `open` в условии — пока шторка закрыта, вложения родителя грузить незачем.
    enabled: open && mode === 'view' && !!parent?.id,
    staleTime: 30_000,
  });
  const parentFiles: TaskAttachment[] = parentFilesQuery.data ?? [];
  const parentFilesLoading = parentFilesQuery.isPending;
  const parentFilesError =
    parentFilesQuery.error instanceof Error
      ? parentFilesQuery.error.message
      : null;
  // Ошибка загрузки и ошибка скачивания показываются в одном месте.
  const visibleFilesError = filesError ?? parentFilesError;

  const downloadParentFile = async (attachment: TaskAttachment) => {
    if (downloadingId) return;
    setDownloadingId(attachment.id);
    setFilesError(null);
    try {
      // Файл принадлежит РОДИТЕЛЮ — подпись и открытие идут по его id.
      const url = await signTaskAttachment(parent!.id, attachment.id);
      const tg = (
        window as {
          Telegram?: {
            WebApp?: {
              downloadFile?: (
                params: { url: string; file_name: string },
                callback?: (accepted: boolean) => void,
              ) => void;
            };
          };
        }
      ).Telegram?.WebApp;

      if (typeof tg?.downloadFile === 'function') {
        let failed = false;
        const accepted = await new Promise<boolean>((resolve) => {
          try {
            tg.downloadFile!(
              { url, file_name: attachment.filename },
              (ok) => resolve(!!ok),
            );
          } catch {
            failed = true;
            resolve(false);
          }
        });
        // accepted=true — скачано нативно; callback(false) без исключения —
        // человек нажал «Отмена», повторно качать не надо.
        if (accepted) return;
        if (!failed) return;
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Не удалось получить файл');
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objUrl;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
    } catch (err) {
      setFilesError(
        err instanceof Error ? err.message : 'Не удалось открыть файл',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  // REV-02: подзадача наследует reviewer_id родителя, поэтому перенос в
  // «Сделано» блокируется тем же предикатом, что и у задачи. Иначе кнопка
  // обещала бы перенос, который Route Handler отвергнет.
  const doneColumnBlocked = isReviewBypassBlocked(
    { reviewer_id: subtask?.reviewer_id ?? null },
    { workerId: currentUserId, role: currentUserRole },
  );

  const startEdit = () => {
    setError(null);
    setDraft({
      text: subtaskText,
      assignedTo: subtask?.assigned_to ?? null,
      deadline: subtask?.deadline ?? null,
    });
    setMode('edit');
  };

  const runPatch = async (payload: Record<string, unknown>) => {
    if (!subtask) return;
    setBusy(true);
    setError(null);
    const failure = await onPatch(subtask.id, payload);
    setBusy(false);
    if (failure) setError(failure);
  };

  const handleSave = async () => {
    if (!subtask) return;
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
    if (!subtask) return;
    const from = subtask.column;
    // SUB-01: короткого пути в «Сделано» нет (решение владельца) — туда
    // ведёт только approve из формы ревью. А вперёд из не-review колонки у
    // задачи открывается шаг «Результат», и колонка не двигается, пока сдача
    // не принята. Раньше подзадача обходила и то и другое: тихо уезжала в
    // review сырым PATCH, без task_submissions, поэтому миграция 142 нечего
    // было сливать в родителя.
    if (targetColumn === 'review' && from !== 'review') {
      onRequestSubmit?.(subtask.id, 'review');
      return;
    }
    void runPatch({ column: targetColumn });
  };

  // SUB-01: причину возврата ревьюер пишет в metadata.last_fix_reason самой
  // строки (миг. 051, review_action(fix)). Показываем её здесь: комментарии у
  // подзадачи не выводятся (решение владельца — только янтарный артефакт в
  // ленте родителя), и иначе исполнитель просто не увидел бы, зачем его
  // вернули.
  const fixReason =
    typeof subtask?.metadata?.last_fix_reason === 'string'
      ? subtask.metadata.last_fix_reason.trim()
      : '';

  // REV-01: префилл «Что сделано» в форме ревью — последняя сдача подзадачи.
  const { data: latestSubmissionData } = useQuery({
    queryKey: ['task-submission-latest', subtask?.id],
    queryFn: () => getLatestTaskSubmission(subtask!.id!),
    enabled: !!(open && mode === 'view' && subtask?.id && subtask.column === 'review'),
    staleTime: 30_000,
  });

  const handleReview = async (action: 'approve' | 'fix', reason?: string) => {
    if (!subtask) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const res = await reviewTask(subtask.id, {
        action,
        reason: action === 'fix' ? reason : undefined,
        expected_version: subtask.version ?? undefined,
      });
      if ('error' in res) throw new Error(res.error);
      onReviewResolved?.();
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : 'Не удалось обработать решение',
      );
    } finally {
      setReviewLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!subtask) return;
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
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div>
            <h2 className="text-[19px] font-medium text-text">
              Подзадача {subtask?.full_id}
            </h2>
          </div>

          {parentText && (
            <>
              <SectionHeader title="Контекст" />
              {/* Клик ведёт в карточку родителя: при открытии шторки из стрима
                  родитель на экране отсутствует, и иначе добраться до него
                  было бы неоткуда. */}
              <button
                type="button"
                onClick={onOpenParent}
                disabled={!onOpenParent}
                className="block w-full appearance-none border-0 bg-transparent p-0 text-left disabled:cursor-default"
                aria-label={`Открыть задачу ${parent?.full_id ?? ''}`}
              >
                <Card>
                  <p className="text-[14px] leading-relaxed text-text-secondary">
                    {parentText}
                  </p>
                  {onOpenParent && (
                    <p className="mt-2 font-mono text-[12px] text-text-muted underline underline-offset-2">
                      {parent?.full_id}
                    </p>
                  )}
                </Card>
              </button>
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

              {/* Тот же SingleDateField, что в задаче — в обоих режимах. Раньше
                  в просмотре была своя строка `<Calendar/> + дата`: другое
                  форматирование, без рамки. У задачи в просмотре поле тоже
                  рендерится, просто disabled. */}
              <SingleDateField
                date={subtask?.deadline ? new Date(subtask.deadline) : null}
                onOpen={() => {}}
                placeholder="Дата окончания"
                disabled
              />

              {assignee && (
                <ParticipantCard
                  id={assignee.id}
                  displayName={assignee.displayName}
                  avatarUrl={assignee.avatarUrl}
                  role="Исполнитель"
                />
              )}

              {/* Контекст из МАТЕРИНСКОЙ задачи (решение владельца): блоки
                  «Внешние ссылки» и «Файлы» берутся из родителя, без заголовков
                  секций и только когда они реально есть.

                  Read-only намеренно: подзадача не владеет этими данными, и
                  редактирование здесь завело бы вторую точку правки одного и
                  того же поля `metadata.external_links` и того же списка
                  вложений — с расхождением между двумя шторками. */}
              {parentLinks.length > 0 && (
                <ExternalLinksCard
                  enabled
                  readOnly
                  links={parentLinks}
                  onEnabledChange={noop}
                  onLinksChange={noop}
                />
              )}

              {parentFilesLoading && parentFiles.length === 0 && (
                <div className="flex items-center gap-2 text-[13px] text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загрузка файлов…
                </div>
              )}

              {parentFiles.length > 0 && (
                <Card>
                  <div className="flex flex-col gap-2">
                    {parentFiles.map((a) => (
                      <NotchedPanel
                        key={a.id}
                        corner="field"
                        fill="var(--color-surface)"
                        className="h-11"
                        contentClassName="flex h-full w-full items-center justify-between gap-2 px-4"
                      >
                        {downloadingId === a.id ? (
                          <span className="flex items-center gap-2 text-[13px] text-text-muted">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Скачивание…
                          </span>
                        ) : (
                          <>
                            <span className="flex min-w-0 items-center gap-2 text-[13px]">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                              <span className="min-w-0 truncate">{a.filename}</span>
                              <span className="shrink-0 text-text-faint">
                                {formatBytes(a.size_bytes)}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void downloadParentFile(a)}
                              disabled={downloadingId != null}
                              className="shrink-0 rounded p-1 text-text-muted transition-colors hover:text-text-primary"
                              aria-label={`Скачать ${a.filename}`}
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </NotchedPanel>
                    ))}
                  </div>
                </Card>
              )}

              {visibleFilesError && (
                <p className="text-[13px] text-[var(--color-priority-red-text)]">
                  {visibleFilesError}
                </p>
              )}

              {fixReason && mode === 'view' && (
                <>
                  <SectionHeader title="Возвращено на доработку" />
                  <Card>
                    <p className="text-[14px] leading-relaxed text-text-secondary">
                      {fixReason}
                    </p>
                  </Card>
                </>
              )}

              {/* REV-01: решение ревьюера. Так же, как в TaskViewEdit: только
                  на «На проверке» и только в режиме просмотра. */}
              {mode === 'view' && subtask?.column === 'review' && open && (
                <ReviewDecisionBlock
                  task={subtask}
                  currentUserId={currentUserId ?? undefined}
                  currentUserRole={currentUserRole}
                  latestSubmission={latestSubmissionData?.submission ?? null}
                  loading={reviewLoading}
                  error={reviewError}
                  onApprove={() => void handleReview('approve')}
                  onFix={(reason) => void handleReview('fix', reason)}
                />
              )}

              {canEdit && (
                // Заголовка «Действия» нет: две кнопки подряд после блоков
                // читались как отдельный раздел, которого в шторке задачи нет.
                <div className="flex flex-col gap-2">
                  <Button
                    variant="solid"
                    disabled={busy}
                    onClick={() => {
                      setMoveColumn(subtask?.column ?? 'backlog');
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
                    Редактировать
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <SectionHeader title="Содержание подзадачи" />
              <TextArea
                corner="field"
                value={draft.text}
                onChange={(value) =>
                  setDraft((d) => ({ ...d, text: value }))
                }
                placeholder="Что нужно сделать"
              />

              <SectionHeader title="Срок и исполнитель" />
              {/* Тот же SingleDateField, что в задаче: плейсхолдер
                  «Дата окончания» и тот же шеврон. Кнопка «Задать срок»
                  выглядела отдельным контролом и не совпадала с задачей. */}
              <SingleDateField
                date={draft.deadline ? new Date(draft.deadline) : null}
                onOpen={() => setDeadlineOpen(true)}
                placeholder="Дата окончания"
                disabled={busy}
              />

              {draftAssignee && (
                <ParticipantCard
                  id={draftAssignee.id}
                  displayName={draftAssignee.displayName}
                  avatarUrl={draftAssignee.avatarUrl}
                  role="Исполнитель"
                />
              )}

              <div className="flex flex-col gap-2">
                {/* Формулировка и логика — как у задачи (TaskViewEdit):
                    карточка исполнителя + «Сменить/Добавить исполнителя». */}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setAssigneeOpen(true)}
                  className="w-full"
                >
                  {draftAssignee ? 'Сменить исполнителя' : 'Добавить исполнителя'}
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
                {canDelete && (
                  <Button
                    variant="solid"
                    fill="#EF4444"
                    textColor="#FAFAFA"
                    disabled={busy || deleting}
                    onClick={() => setConfirmDelete(true)}
                    className="w-full"
                  >
                    Удалить подзадачу
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
            title="Выберите исполнителя"
            // Без `stacked` шторка выбора ложилась ПОД родительской BottomSheet
            // (у неё свой transform-контекст) — кнопка выглядела рабочей, а по
            // факту ничего не открывала. Так же подключён в TaskViewEdit.
            stacked
            onSelect={(id) => setDraft((d) => ({ ...d, assignedTo: id }))}
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
          task={{ full_id: subtask?.full_id ?? '', title: subtaskText }}
          currentColumn={subtask?.column ?? 'backlog'}
          selectedColumn={moveColumn}
          onSelect={setMoveColumn}
          onConfirm={handleMoveConfirm}
          disabledColumns={['done']}
          disabledReason={SUBTASK_DONE_REQUIRES_REVIEW}
        />
      )}

      {deleteConfirmModal}
    </>
  );
}
