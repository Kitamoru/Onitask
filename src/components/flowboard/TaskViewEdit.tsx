'use client';

/**
 * TaskViewEdit — 2-in-1 task component (view/edit modes).
 *
 * View mode: all fields are disabled/readonly (like board view) with a
 * solid "Редактировать" button at the bottom.
 * Edit mode: all fields are active with save/cancel actions.
 *
 * Layout: single canvas (no wizard steps) with sections:
 * - Ключевой контекст (название, описание, дедлайн)
 * - Стоимость (SP/CW steppers)
 * - Ответственность (исполнитель, проверяющий)
 * - Дополнительный контекст (чеклист, связанные, зависимые, внешние ссылки)
 *
 * Segments: "Общее" (active) / "Комментарии" (inactive — later).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Upload, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import {
  TextInput,
  TextArea,
  Button,
  NotchedPanel,
  Stepper,
  ToggleSwitch,
  Segments,
  SectionHeader,
  Card,
  CountBadge,
} from '@/components/ui/desk-ui';
import { SingleDateField } from '@/components/ui/SingleDateField';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { patchTask, createTask, deleteTask } from '@/lib/api/flow';
import {
  getTaskAttachments,
  uploadTaskAttachments,
  deleteTaskAttachment,
  type TaskAttachment,
} from '@/lib/api/flow';
import ParticipantCard from './ParticipantCard';
import { WorkerSelectSheet } from './WorkerSelectSheet';
import { MoveTaskSheet } from './MoveTaskSheet';
import { TaskCommentsPanel } from './TaskCommentsPanel';

/** Максимальное число файлов на задачу (синхронизировано с backend-лимитом) */
const MAX_ATTACHMENTS = 5;

export interface TaskViewEditProps {
  /** Whether the bottom sheet is open */
  open: boolean;
  /** Callback when the bottom sheet is closed */
  onClose: () => void;
  /** Task data (empty for new task) */
  task?: Partial<TaskEntity> | null;
  /** Available workers for assignment */
  workers: WorkerCardData[];
  /** Mode: view (readonly) or edit (editable) */
  mode?: 'view' | 'edit';
  /** Callback on save */
  onSave?: (task: TaskEntity) => void;
  /** Called immediately after successful task deletion (before onClose) */
  onDelete?: (taskId: string) => void;
  /** Callback when the user moves the task to a different column (optimistic — called immediately) */
  onMoveTask?: (taskId: string, newColumn: string) => void;
  /** Current user's worker ID (for highlighting own comments on the right) */
  currentUserId?: string;
  /** FILE-03: initial tab for deep-link «Обсудить задачу» → comments */
  initialTab?: 'general' | 'comments';
  /** Custom className */
  className?: string;
}

export function TaskViewEdit({
  open,
  onClose,
  task,
  workers,
  mode = 'view',
  onSave,
  onDelete,
  onMoveTask,
  currentUserId,
  initialTab = 'general',
  className = '',
}: TaskViewEditProps) {
  const [internalMode, setInternalMode] = useState<'view' | 'edit'>(mode);
  const isView = internalMode === 'view';
  const isEdit = internalMode === 'edit';
  const isNew = !task?.id;

  // Segments: Общее (active) / Комментарии (inactive)
  const [tab, setTab] = useState<'general' | 'comments'>('general');

  // Form state
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [storyPoints, setStoryPoints] = useState(task?.story_points ?? 1);
  const [cognitiveWeight, setCognitiveWeight] = useState(task?.cognitive_weight ?? 1);
  const [deadline, setDeadline] = useState<Date | null>(
    task?.deadline ? new Date(task.deadline) : null,
  );
  const [checklistEnabled, setChecklistEnabled] = useState(false);
  const [relatedEnabled, setRelatedEnabled] = useState(false);
  const [linksEnabled, setLinksEnabled] = useState(false);

  // FILE-05: файлы задачи (всегда активный блок, GET-подгрузка при открытии)
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Прогресс и удаление (паттерн DocumentsCard)
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    if (!task?.id) {
      setAttachments([]);
      setAttachmentsError(null);
      return;
    }
    setAttachmentsLoading(true);
    const res = await getTaskAttachments(task.id);
    setAttachments(res.attachments ?? []);
    setAttachmentsError(res.error);
    setAttachmentsLoading(false);
  }, [task?.id]);

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || !task?.id) return;

    const all = Array.from(files);
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const list = all.slice(0, remaining);

    if (list.length === 0) {
      setAttachmentsError(`Достигнут лимит ${MAX_ATTACHMENTS} файлов`);
      return;
    }

    setUploading(true);
    setUploadCount(0);
    setUploadTotal(list.length);
    setAttachmentsError(null);

    let lastError: string | null = null;
    // Каскадная загрузка с прогрессом (uploadCount/uploadTotal)
    for (let i = 0; i < list.length; i++) {
      const res = await uploadTaskAttachments(task.id, [list[i]]);
      if (res.error) {
        lastError = res.error;
      } else {
        setAttachments((prev) => [...prev, ...res.attachments]);
      }
      setUploadCount(i + 1);
    }

    setUploading(false);

    // Приоритет сообщений: усечение важнее частной ошибки
    if (all.length > remaining) {
      setAttachmentsError(
        `Прикреплено ${list.length} из ${all.length} — лимит ${MAX_ATTACHMENTS} файлов`,
      );
    } else if (lastError) {
      setAttachmentsError(lastError);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!task?.id || deletingId) return;
    setDeletingId(attachmentId);
    const res = await deleteTaskAttachment(task.id, attachmentId);
    if (res.success) {
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      setAttachmentsError(null);
    } else {
      setAttachmentsError(res.error ?? null);
    }
    setDeletingId(null);
  };

  // Assignment state
  const [assignedTo, setAssignedTo] = useState<string | null>(task?.assigned_to ?? null);
  const [reviewerId, setReviewerId] = useState<string | null>(task?.reviewer_id ?? null);

  // Worker select sheets
  const [assigneeSheetOpen, setAssigneeSheetOpen] = useState(false);
  const [reviewerSheetOpen, setReviewerSheetOpen] = useState(false);

  // Move task sheet (Переместить): target column picked in MoveTaskSheet
  const currentTaskColumn = task?.column ?? 'backlog';
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  const [moveTargetColumn, setMoveTargetColumn] = useState<string>(currentTaskColumn);

  // Keep the move target in sync when the sheet reopens on a freshly-selected task
  useEffect(() => {
    if (!open) return;
    setMoveTargetColumn(task?.column ?? 'backlog');
  }, [open, task?.column, task?.id]);

  const handleMoveConfirm = useCallback(
    (targetColumn: string) => {
      if (!task?.id || !onMoveTask) return;
      onMoveTask(task.id, targetColumn);
      // Optimistic local sync: close so the stale view doesn't linger
      setMoveSheetOpen(false);
      onClose();
    },
    [task, onMoveTask, onClose],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset internal mode when the sheet opens or the task changes
  useEffect(() => {
    if (open) {
      setInternalMode(mode);
      setTab(initialTab);
      setError(null);
      setShowDeleteConfirm(false);
      loadAttachments();
    }
  }, [open, mode, initialTab, loadAttachments]);

  // Sync state when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setStoryPoints(task.story_points ?? 1);
      setCognitiveWeight(task.cognitive_weight ?? 1);
      setDeadline(task.deadline ? new Date(task.deadline) : null);
      setAssignedTo(task.assigned_to ?? null);
      setReviewerId(task.reviewer_id ?? null);
    }
  }, [task]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Название обязательно');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = {
        ...(task?.metadata ?? {}),
        checklist: checklistEnabled ? (task?.metadata?.checklist ?? []) : [],
        related_tasks: relatedEnabled ? (task?.metadata?.related_tasks ?? []) : [],
        external_links: linksEnabled ? (task?.metadata?.external_links ?? []) : [],
      };

      if (isNew) {
        const result = await createTask({
          title: title.trim(),
          description: description || undefined,
          column: 'backlog',
          story_points: storyPoints,
          cognitive_weight: cognitiveWeight,
          deadline: deadline ? deadline.toISOString() : undefined,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.task) {
          onSave?.(result.task);
          onClose();
        }
      } else if (task?.id) {
        const patch: Parameters<typeof patchTask>[1] = {
          title: title.trim(),
          description: description || undefined,
          story_points: storyPoints,
          cognitive_weight: cognitiveWeight,
          deadline: deadline ? deadline.toISOString() : undefined,
          metadata,
        };
        if (assignedTo !== task.assigned_to) {
          patch.assigned_to = assignedTo;
        }
        if (reviewerId !== task.reviewer_id) {
          patch.reviewer_id = reviewerId;
        }
        const result = await patchTask(task.id, patch);
        if (result.task) {
          onSave?.(result.task);
          onClose();
        } else if (result.warning) {
          setError(result.warning);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!task?.id) return;
    setDeleting(true);
    setShowDeleteConfirm(false);
    try {
      const result = await deleteTask(task.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      onDelete?.(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setDeleting(false);
    }
  };

  const findWorker = (id: string | null): WorkerCardData | undefined => {
    if (!id) return undefined;
    return workers.find((w) => w.id === id);
  };

  const assigneeWorker = findWorker(assignedTo);
  const reviewerWorker = findWorker(reviewerId);

  // Humans and AI agents are both assignable (agents receive tasks via MCP)
  const availableForAssignee = workers.filter((w) => w.id !== reviewerId);
  const availableForReviewer = workers.filter((w) => w.id !== assignedTo);

  // Confirm вне BottomSheet: fixed внутри transform-шита цепляется к нему,
  // а не к viewport — после скролла длинной задачи модалку не видно.
  const deleteConfirmModal =
    showDeleteConfirm &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        onClick={() => {
          if (!deleting) setShowDeleteConfirm(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-task-title"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6"
          style={{ backgroundColor: '#1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="delete-task-title"
            className="mb-2 text-center text-lg font-semibold"
            style={{ color: '#FAFAFA' }}
          >
            Удалить задачу?
          </p>
          <p className="mb-6 text-center text-sm" style={{ color: '#8B8B8B' }}>
            Все связанные данные будут удалены без возможности восстановления.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              onClick={handleDeleteTask}
              disabled={deleting}
              fill="#EF4444"
              textColor="#FAFAFA"
            >
              {deleting ? 'Удаление...' : 'Удалить задачу'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
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

  const attachLimitReached = attachments.length >= MAX_ATTACHMENTS;

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div
          className={`flex flex-col gap-6 px-4 pb-6 ${className}`}
          aria-label={isView ? 'Просмотр задачи' : 'Редактирование задачи'}
        >
          {/* Segments: Общее / Комментарии */}
          <Segments
            value={tab}
            onChange={(v) => setTab(v)}
            disabled={isEdit}
            options={[
              { value: 'general', label: 'Общее' },
              { value: 'comments', label: 'Комментарии' },
            ]}
          />

          {/* Комментарии tab (AGENT-08): feed + composer */}
          {tab === 'comments' && task?.id && (
            <div className="h-[60vh] min-h-0">
              <TaskCommentsPanel
                taskId={task.id}
                workers={workers.map((w) => ({
                  id: w.id,
                  avatarUrl: w.avatarUrl,
                  displayName: w.displayName,
                }))}
                currentUserId={currentUserId}
              />
            </div>
          )}

          {/* General sections — only on the «Общее» tab */}
          {tab === 'general' && (
            <>
              {/* Ключевой контекст */}
              <section>
                <SectionHeader title="Ключевой контекст" />
                <div className="flex flex-col gap-3">
                  <TextArea
                    value={title}
                    onChange={(v) => setTitle(v)}
                    placeholder="Название задачи"
                    disabled={isView}
                    maxLength={500}
                    corner="field"
                  />
                  <TextArea
                    value={description}
                    onChange={setDescription}
                    placeholder="Описание задачи"
                    disabled={isView}
                    maxLength={5000}
                    corner="field"
                  />
                  <SingleDateField
                    date={deadline}
                    onOpen={() => setIsDateSheetOpen(true)}
                    placeholder="Дата окончания"
                    disabled={isView}
                  />
                </div>
              </section>

              {/* Стоимость */}
              <section>
                <SectionHeader title="Стоимость" />
                <div className="flex flex-col gap-3">
                  <Stepper
                    value={storyPoints}
                    unitLabel={(n) => `${n} SP`}
                    min={1}
                    max={30}
                    onChange={setStoryPoints}
                    borderGradient={[
                      'var(--color-grad-add-from)',
                      'var(--color-grad-add-to)',
                    ]}
                    disabled={isView}
                  />
                  <Stepper
                    value={cognitiveWeight}
                    unitLabel={(n) => `${n} CW`}
                    min={1}
                    max={10}
                    onChange={setCognitiveWeight}
                    borderGradient={[
                      'var(--color-grad-add-from)',
                      'var(--color-grad-add-to)',
                    ]}
                    disabled={isView}
                  />
                </div>
              </section>

              {/* Ответственность */}
              <section>
                <SectionHeader title="Ответственность" />
                <div className="flex flex-col gap-3">
                  {task?.created_by &&
                    (() => {
                      const creatorWorker =
                        workers.find((w) => w.id === task.created_by) ??
                        workers.find((w) => w.displayName === task.created_by);
                      if (!creatorWorker) return null;
                      return (
                        <ParticipantCard
                          id={creatorWorker.id}
                          displayName={creatorWorker.displayName}
                          avatarUrl={creatorWorker.avatarUrl}
                          role="Постановщик"
                        />
                      );
                    })()}

                  {assigneeWorker && (
                    <ParticipantCard
                      id={assigneeWorker.id}
                      displayName={assigneeWorker.displayName}
                      avatarUrl={assigneeWorker.avatarUrl}
                      role="Исполнитель"
                    />
                  )}

                  {reviewerWorker && (
                    <ParticipantCard
                      id={reviewerWorker.id}
                      displayName={reviewerWorker.displayName}
                      avatarUrl={reviewerWorker.avatarUrl}
                      role="Проверяющий"
                    />
                  )}

                  {!isView && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => setAssigneeSheetOpen(true)}
                        className="w-full"
                      >
                        {assigneeWorker ? 'Сменить исполнителя' : 'Добавить исполнителя'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setReviewerSheetOpen(true)}
                        className="w-full"
                      >
                        {reviewerWorker
                          ? 'Сменить проверяющего'
                          : 'Добавить проверяющего'}
                      </Button>
                    </>
                  )}
                </div>
              </section>

              {/* Дополнительный контекст */}
              <section>
                <SectionHeader title="Дополнительный контекст" />
                <div className="flex flex-col gap-3">
                  <Card>
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-medium text-text">
                        Чеклист задачи
                      </span>
                      <ToggleSwitch
                        checked={checklistEnabled}
                        onChange={setChecklistEnabled}
                        label="Чеклист задачи"
                        disabled={isView}
                      />
                    </div>
                  </Card>
                  <Card>
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-medium text-text">
                        Связанные задачи
                      </span>
                      <ToggleSwitch
                        checked={relatedEnabled}
                        onChange={setRelatedEnabled}
                        label="Связанные задачи"
                        disabled={isView}
                      />
                    </div>
                  </Card>
                  <Card>
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-medium text-text">
                        Внешние ссылки
                      </span>
                      <ToggleSwitch
                        checked={linksEnabled}
                        onChange={setLinksEnabled}
                        label="Внешние ссылки"
                        disabled={isView}
                      />
                    </div>
                  </Card>
                </div>
              </section>

              {/* 📎 Файлы задачи — всегда активный блок (FILE-05, UI: DocumentsCard) */}
              {!isNew && (
                <section>
                  <SectionHeader title="Файлы" />
                  <Card>
                    <div className="flex flex-col gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.zip,.ogg,.mp3"
                        hidden
                        onChange={(e) => {
                          handleAttachFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />

                      {/* Скелетон при первичной загрузке списка */}
                      {attachmentsLoading && attachments.length === 0 && (
                        <div className="flex items-center gap-2 py-2 text-[13px] text-text-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Загрузка файлов…
                        </div>
                      )}

                      {/* Список файлов — NotchedPanel строки (как DocumentsCard) */}
                      {attachments.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {attachments.map((a) => {
                            const isDeleting = deletingId === a.id;
                            return (
                              <li key={a.id}>
                                <NotchedPanel
                                  corner="field"
                                  fill="var(--color-surface)"
                                  className="h-11"
                                  contentClassName="flex h-full w-full items-center justify-between px-4 gap-2"
                                >
                                  {isDeleting ? (
                                    <span className="flex items-center gap-2 text-[13px] text-text-muted">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Удаление…
                                    </span>
                                  ) : (
                                    <span className="flex min-w-0 items-center gap-2 text-[13px]">
                                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                      {a.url ? (
                                        <a
                                          href={a.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="truncate underline decoration-text-faint underline-offset-2"
                                        >
                                          {a.filename}
                                        </a>
                                      ) : (
                                        <span className="truncate">{a.filename}</span>
                                      )}
                                      <span className="shrink-0 text-text-faint">
                                        {formatBytes(a.size_bytes)}
                                      </span>
                                    </span>
                                  )}
                                  {!isView && (
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => handleDeleteAttachment(a.id)}
                                      className="shrink-0 rounded p-1 text-text-muted transition-colors hover:text-[var(--color-priority-red-text)]"
                                      aria-label="Удалить файл"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <X className="h-4 w-4" />
                                      )}
                                    </button>
                                  )}
                                </NotchedPanel>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {/* Полоса загрузки (как DocumentsCard uploadProgress/uploadTotal) */}
                      {uploading && (
                        <div className="rounded-lg bg-[var(--color-surface)] px-4 py-3">
                          <div className="mb-1 flex items-center justify-between text-[13px]">
                            <span className="text-text-muted">Загрузка…</span>
                            <span className="text-text-faint">
                              {uploadCount}/{uploadTotal}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-strong)]">
                            <div
                              className="h-full rounded-full bg-[var(--color-accent-amber)] transition-all duration-300"
                              style={{
                                width: `${
                                  uploadTotal > 0
                                    ? Math.round((uploadCount / uploadTotal) * 100)
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Кнопка загрузки — NotchedPanel field (как DocumentsCard) */}
                      {!isView && (
                        <>
                          <button
                            type="button"
                            disabled={uploading || attachLimitReached}
                            onClick={() => fileInputRef.current?.click()}
                            className="block h-10 w-full appearance-none border-0 bg-transparent p-0 text-left disabled:opacity-40"
                          >
                            <NotchedPanel
                              corner="field"
                              fill="var(--color-surface)"
                              className="h-full"
                              contentClassName="flex h-full w-full items-center justify-between px-4"
                            >
                              <span className="truncate text-base text-text-faint">
                                {uploading
                                  ? 'Загрузка…'
                                  : attachLimitReached
                                  ? 'Достигнут лимит файлов'
                                  : attachments.length > 0
                                  ? 'Добавить файлы'
                                  : 'Выберите файл'}
                              </span>
                              <Upload className="h-[18px] w-[18px] shrink-0 text-text-muted" />
                            </NotchedPanel>
                          </button>

                          {/* Лимиты + счётчик (как DocumentsCard) */}
                          <div className="flex items-start justify-between gap-3">
                            <p className="flex-1 text-[13px] leading-[1.4] text-text-muted">
                              до {MAX_ATTACHMENTS} файлов, до 2 МБ каждый, 3 МБ суммарно
                            </p>
                            <CountBadge>
                              {attachments.length}/{MAX_ATTACHMENTS}
                            </CountBadge>
                          </div>
                        </>
                      )}

                      {/* View-режим без файлов */}
                      {isView &&
                        !attachmentsLoading &&
                        attachments.length === 0 && (
                          <p className="py-2 text-[13px] text-text-faint">
                            Нет прикреплённых файлов
                          </p>
                        )}

                      {attachmentsError && (
                        <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-priority-red-text)]">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          {attachmentsError}
                        </div>
                      )}
                    </div>
                  </Card>
                </section>
              )}
            </>
          )}

          {/* Error — only on the «Общее» tab (irrelevant in comments) */}
          {tab === 'general' && error && (
            <div
              className="px-3 py-2 rounded text-sm"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--color-priority-red-text)',
                border: '1px solid var(--color-priority-red-border)',
                borderRadius: 'var(--radius-flowboard-section)',
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Actions — only on the «Общее» tab (irrelevant in comments) */}
          {tab === 'general' && isView && !isNew && (
            <div className="mt-2 flex flex-col gap-2">
              {/* Move — amber solid, opens the MoveTaskSheet */}
              <Button
                variant="solid"
                onClick={() => {
                  setMoveTargetColumn(task?.column ?? 'backlog');
                  setMoveSheetOpen(true);
                }}
                className="w-full"
              >
                Переместить
              </Button>
              {/* Edit — black fill + green gradient border (Добавить-style) */}
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
                  onClick={() => setInternalMode('edit')}
                  className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-text"
                >
                  Редактировать
                </button>
              </NotchedPanel>
            </div>
          )}
          {tab === 'general' && isEdit && (
            <div className="mt-2 flex flex-col gap-2">
              <Button
                onClick={handleSave}
                disabled={loading || !title.trim()}
                variant="solid"
                className="w-full"
              >
                {loading ? 'Сохранение...' : 'Сохранить'}
              </Button>
              <Button
                variant="solid"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading || deleting}
                fill="#EF4444"
                textColor="#FAFAFA"
              >
                Удалить задачу
              </Button>
            </div>
          )}

          <SingleDateSheet
            open={isDateSheetOpen}
            onClose={() => setIsDateSheetOpen(false)}
            date={deadline}
            onConfirm={(d: Date) => {
              setDeadline(d);
              setIsDateSheetOpen(false);
            }}
          />
        </div>
      </BottomSheet>

      {/* Delete confirm — portal to body, above BottomSheet transform context */}
      {deleteConfirmModal}

      {/* Worker select sheets — outside BottomSheet (same portal stacking reason) */}
      <WorkerSelectSheet
        open={assigneeSheetOpen}
        onClose={() => setAssigneeSheetOpen(false)}
        workers={availableForAssignee}
        selectedId={assignedTo}
        onSelect={(id) => {
          setAssignedTo(id);
          if (reviewerId === id) {
            setReviewerId(null);
          }
        }}
        title="Выберите исполнителя"
        stacked
      />
      <WorkerSelectSheet
        open={reviewerSheetOpen}
        onClose={() => setReviewerSheetOpen(false)}
        workers={availableForReviewer}
        selectedId={reviewerId}
        onSelect={(id) => {
          setReviewerId(id);
          if (assignedTo === id) {
            setAssignedTo(null);
          }
        }}
        title="Выберите проверяющего"
        stacked
      />
      <MoveTaskSheet
        open={moveSheetOpen}
        onClose={() => setMoveSheetOpen(false)}
        task={task}
        currentColumn={currentTaskColumn}
        selectedColumn={moveTargetColumn}
        onSelect={setMoveTargetColumn}
        onConfirm={handleMoveConfirm}
      />
    </>
  );
}

/** Форматирование размера файла: 0 B / 512 B / 1.2 KB / 3.4 MB */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}