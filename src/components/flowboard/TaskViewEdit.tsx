'use client';

/**
 * TaskViewEdit — 2-in-1 task component (view/edit modes).
 *
 * View mode: all fields are disabled/readonly with a solid "Редактировать" button.
 * Edit mode: all fields are active with save/cancel actions.
 *
 * Layout: single canvas with sections:
 * - Ключевой контекст (название, описание, дедлайн)
 * - Стоимость (SP/CW steppers)
 * - Ответственность (исполнитель, проверяющий)
 * - Дополнительный контекст (чеклист, связанные, внешние ссылки)
 * - Файлы
 *
 * Segments: "Общее" / "Комментарии"
 */
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, X, Loader2, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import {
  SHEET_CHROME_HEIGHT_PX,
  SHEET_CONTENT_MAX_HEIGHT,
  BottomSheet,
} from '@/components/ui/BottomSheet';
import {
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
import type { TaskEntity, WorkerCardData, LatestTaskSubmission } from '@/types/flowboard';
import {
  getTaskAttachments,
  uploadTaskAttachments,
  deleteTaskAttachment,
  signTaskAttachment,
  patchTask,
  createTask,
  deleteTask,
  getLatestTaskSubmission,
  reviewTask,
  type TaskAttachment,
} from '@/lib/api/flow';
import ParticipantCard from './ParticipantCard';
import { WorkerSelectSheet } from './WorkerSelectSheet';
import { MoveTaskSheet } from './MoveTaskSheet';
import { ReviewDecisionBlock } from './ReviewDecisionBlock';
import { TaskCommentsPanel } from './TaskCommentsPanel';
import { ExternalLinksCard, type ExternalLink } from '@/components/desk-create/ExternalLinksCard';

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
  /** REV-01: вызывается после approve/fix с обогащённой задачей (для sync store) */
  onReviewResolved?: (task: TaskEntity) => void;
  /** Current user's worker ID (for highlighting own comments on the right) */
  currentUserId?: string;
  /** FILE-03: initial tab for deep-link «Обсудить задачу» → comments */
  initialTab?: 'general' | 'comments';
  /** Custom className */
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Memoized sections (prevent full-tree re-renders on every keystroke) */
/* ------------------------------------------------------------------ */

const KeyContextSection = memo(function KeyContextSection({
  title,
  description,
  deadline,
  isView,
  onTitleChange,
  onDescriptionChange,
  onOpenDate,
}: {
  title: string;
  description: string;
  deadline: Date | null;
  isView: boolean;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onOpenDate: () => void;
}) {
  return (
    <section>
      <SectionHeader title="Ключевой контекст" />
      <div className="flex flex-col gap-3">
        <TextArea
          value={title}
          onChange={onTitleChange}
          placeholder="Название задачи"
          disabled={isView}
          maxLength={500}
          corner="field"
        />
        <TextArea
          value={description}
          onChange={onDescriptionChange}
          placeholder="Описание задачи"
          disabled={isView}
          maxLength={5000}
          corner="field"
        />
        <SingleDateField
          date={deadline}
          onOpen={onOpenDate}
          placeholder="Дата окончания"
          disabled={isView}
        />
      </div>
    </section>
  );
});

const CostSection = memo(function CostSection({
  storyPoints,
  cognitiveWeight,
  isView,
  onStoryPointsChange,
  onCognitiveWeightChange,
}: {
  storyPoints: number;
  cognitiveWeight: number;
  isView: boolean;
  onStoryPointsChange: (v: number) => void;
  onCognitiveWeightChange: (v: number) => void;
}) {
  return (
    <section>
      <SectionHeader title="Стоимость" />
      <div className="flex flex-col gap-3">
        <Stepper
          value={storyPoints}
          unitLabel={(n) => `${n} SP`}
          min={1}
          max={30}
          onChange={onStoryPointsChange}
          borderGradient={['var(--color-grad-add-from)', 'var(--color-grad-add-to)']}
          disabled={isView}
        />
        <Stepper
          value={cognitiveWeight}
          unitLabel={(n) => `${n} CW`}
          min={1}
          max={10}
          onChange={onCognitiveWeightChange}
          borderGradient={['var(--color-grad-add-from)', 'var(--color-grad-add-to)']}
          disabled={isView}
        />
      </div>
    </section>
  );
});

const ResponsibilitySection = memo(function ResponsibilitySection({
  task,
  workers,
  assigneeWorker,
  reviewerWorker,
  isView,
  onOpenAssignee,
  onOpenReviewer,
}: {
  task?: Partial<TaskEntity> | null;
  workers: WorkerCardData[];
  assigneeWorker?: WorkerCardData;
  reviewerWorker?: WorkerCardData;
  isView: boolean;
  onOpenAssignee: () => void;
  onOpenReviewer: () => void;
}) {
  const creatorWorker = task?.created_by
    ? workers.find((w) => w.id === task.created_by) ??
      workers.find((w) => w.displayName === task.created_by)
    : undefined;

  return (
    <section>
      <SectionHeader title="Ответственность" />
      <div className="flex flex-col gap-3">
        {creatorWorker && (
          <ParticipantCard
            id={creatorWorker.id}
            displayName={creatorWorker.displayName}
            avatarUrl={creatorWorker.avatarUrl}
            role="Постановщик"
          />
        )}

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
            <Button variant="outline" onClick={onOpenAssignee} className="w-full">
              {assigneeWorker ? 'Сменить исполнителя' : 'Добавить исполнителя'}
            </Button>
            <Button variant="outline" onClick={onOpenReviewer} className="w-full">
              {reviewerWorker ? 'Сменить проверяющего' : 'Добавить проверяющего'}
            </Button>
          </>
        )}
      </div>
    </section>
  );
});

const ExtraContextSection = memo(function ExtraContextSection({
  checklistEnabled,
  relatedEnabled,
  linksEnabled,
  links,
  isView,
  onChecklistChange,
  onRelatedChange,
  onLinksEnabledChange,
  onLinksChange,
}: {
  checklistEnabled: boolean;
  relatedEnabled: boolean;
  linksEnabled: boolean;
  links: ExternalLink[];
  isView: boolean;
  onChecklistChange: (v: boolean) => void;
  onRelatedChange: (v: boolean) => void;
  onLinksEnabledChange: (v: boolean) => void;
  onLinksChange: (links: ExternalLink[]) => void;
}) {
  return (
    <section>
      <SectionHeader title="Дополнительный контекст" />
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-text">Чеклист задачи</span>
            <ToggleSwitch
              checked={checklistEnabled}
              onChange={onChecklistChange}
              label="Чеклист задачи"
              disabled={isView}
            />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-text">Связанные задачи</span>
            <ToggleSwitch
              checked={relatedEnabled}
              onChange={onRelatedChange}
              label="Связанные задачи"
              disabled={isView}
            />
          </div>
        </Card>
        <ExternalLinksCard
          enabled={linksEnabled}
          onEnabledChange={onLinksEnabledChange}
          links={links}
          onLinksChange={onLinksChange}
          disabled={isView}
          readOnly={isView}
        />
      </div>
    </section>
  );
});

const FilesSection = memo(function FilesSection({
  attachments,
  attachmentsLoading,
  attachmentsErrorText,
  uploading,
  uploadCount,
  uploadTotal,
  deletingId,
  downloadingId,
  isView,
  attachLimitReached,
  fileInputRef,
  onAttachClick,
  onDelete,
  onDownload,
  onFileChange,
}: {
  attachments: TaskAttachment[];
  attachmentsLoading: boolean;
  attachmentsErrorText: string | null;
  uploading: boolean;
  uploadCount: number;
  uploadTotal: number;
  deletingId: string | null;
  downloadingId: string | null;
  isView: boolean;
  attachLimitReached: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachClick: () => void;
  onDelete: (id: string) => void;
  onDownload: (a: TaskAttachment) => void;
  onFileChange: (files: FileList | null) => void;
}) {
  return (
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
              onFileChange(e.target.files);
              e.target.value = '';
            }}
          />

          {attachmentsLoading && attachments.length === 0 && (
            <div className="flex items-center gap-2 py-2 text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка файлов…
            </div>
          )}

          {attachments.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {attachments.map((a) => {
                const isDeleting = deletingId === a.id;
                const isDownloading = downloadingId === a.id;
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
                        <>
                          <span className="flex min-w-0 items-center gap-2 text-[13px]">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            <button
                              type="button"
                              disabled={isDownloading}
                              onClick={() => onDownload(a)}
                              className="min-w-0 truncate text-left underline decoration-text-faint underline-offset-2 transition-colors hover:text-text-primary disabled:opacity-50"
                              aria-label={`Скачать ${a.filename}`}
                            >
                              {a.filename}
                            </button>
                            <span className="shrink-0 text-text-faint">
                              {formatBytes(a.size_bytes)}
                            </span>
                          </span>
                          {isView && (
                            <button
                              type="button"
                              disabled={isDownloading}
                              onClick={() => onDownload(a)}
                              className="shrink-0 rounded p-1 text-text-muted transition-colors hover:text-text-primary"
                              aria-label="Скачать файл"
                            >
                              {isDownloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </>
                      )}
                      {!isView && (
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => onDelete(a.id)}
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
                      uploadTotal > 0 ? Math.round((uploadCount / uploadTotal) * 100) : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {!isView && (
            <>
              <button
                type="button"
                disabled={uploading || attachLimitReached}
                onClick={onAttachClick}
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

          {isView && !attachmentsLoading && attachments.length === 0 && (
            <p className="py-2 text-[13px] text-text-faint">Нет прикреплённых файлов</p>
          )}

          {attachmentsErrorText && (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-priority-red-text)]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {attachmentsErrorText}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
});

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function TaskViewEdit({
  open,
  onClose,
  task,
  workers,
  mode = 'view',
  onSave,
  onDelete,
     onMoveTask,
  onReviewResolved,
  currentUserId,
  initialTab = 'general',
  className = '',
}: TaskViewEditProps) {
  const [internalMode, setInternalMode] = useState<'view' | 'edit'>(mode);
  const isView = internalMode === 'view';
  const isEdit = internalMode === 'edit';
  const isNew = !task?.id;

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
  const [links, setLinks] = useState<ExternalLink[]>([]);

  // FILE-05: файлы задачи — манифест через React Query (изоляция по queryKey per task,
  // устраняет гонку «файлы задачи A показаны в шторке задачи B»).
  // Кэш = единственный источник истины: upload/delete обновляют setQueryData, после каскада — invalidate.
  const queryClient = useQueryClient();
  // Мемоизированный ключ: стабильная идентичность → useCallback-хендлеры ниже
  // не пересоздаются на каждый рендер → memo(FilesSection) работает.
  const attachmentsQueryKey = useMemo(() => ['task-attachments', task?.id] as const, [task?.id]);
  const {
    data: attachments = [],
    isPending: attachmentsLoading,
    error: attachmentsQueryError,
  } = useQuery({
    queryKey: attachmentsQueryKey,
    queryFn: () => getTaskAttachments(task?.id ?? ''),
    enabled: open && !!task?.id,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  });
  // Ошибки действий (upload/delete/download) поверх ошибки самого запроса
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const attachmentsErrorText =
    attachmentsError ??
    (attachmentsQueryError instanceof Error ? attachmentsQueryError.message : null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Прогресс, удаление и скачивание (паттерн DocumentsCard)
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Assignment
  const [assignedTo, setAssignedTo] = useState<string | null>(task?.assigned_to ?? null);
  const [reviewerId, setReviewerId] = useState<string | null>(task?.reviewer_id ?? null);

  const [assigneeSheetOpen, setAssigneeSheetOpen] = useState(false);
  const [reviewerSheetOpen, setReviewerSheetOpen] = useState(false);

  const currentTaskColumn = task?.column ?? 'backlog';
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  const [moveTargetColumn, setMoveTargetColumn] = useState<string>(currentTaskColumn);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync on open / task change
  useEffect(() => {
    if (open) {
      setInternalMode(mode);
      setTab(initialTab);
      setError(null);
      setShowDeleteConfirm(false);
      setAttachmentsError(null);
    }
  }, [open, mode, initialTab]);

  useEffect(() => {
    if (!open) return;
    setMoveTargetColumn(task?.column ?? 'backlog');
  }, [open, task?.column, task?.id]);

  useEffect(() => {
    if (task) {
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setStoryPoints(task.story_points ?? 1);
      setCognitiveWeight(task.cognitive_weight ?? 1);
      setDeadline(task.deadline ? new Date(task.deadline) : null);
      setAssignedTo(task.assigned_to ?? null);
      setReviewerId(task.reviewer_id ?? null);
      // Внешние ссылки: инициализируем из metadata (как в настройках доски —
      // если ссылки есть, блок открыт включённым)
      const taskLinks = (task.metadata?.external_links ?? []) as ExternalLink[];
      setLinks(taskLinks);
      setLinksEnabled(taskLinks.length > 0);
    }
  }, [task]);

  /* ---------- Stable callbacks ---------- */

  const handleTitleChange = useCallback((v: string) => setTitle(v), []);
  const handleDescriptionChange = useCallback((v: string) => setDescription(v), []);

  const handleStoryPointsChange = useCallback((v: number) => setStoryPoints(v), []);
  const handleCognitiveWeightChange = useCallback((v: number) => setCognitiveWeight(v), []);
  const handleOpenDate = useCallback(() => setIsDateSheetOpen(true), []);
  const handleChecklistChange = useCallback((v: boolean) => setChecklistEnabled(v), []);
  const handleRelatedChange = useCallback((v: boolean) => setRelatedEnabled(v), []);
  const handleLinksEnabledChange = useCallback((v: boolean) => setLinksEnabled(v), []);
  const handleLinksChange = useCallback((next: ExternalLink[]) => setLinks(next), []);

  const handleOpenAssignee = useCallback(() => setAssigneeSheetOpen(true), []);
  const handleOpenReviewer = useCallback(() => setReviewerSheetOpen(true), []);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAttachFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !task?.id) return;

      const taskId = task.id;
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
      for (let i = 0; i < list.length; i++) {
        const res = await uploadTaskAttachments(taskId, [list[i]]);
        if (res.error) {
          lastError = res.error;
        } else if (res.attachments.length > 0) {
          queryClient.setQueryData<TaskAttachment[]>(attachmentsQueryKey, (prev = []) => [
            ...prev,
            ...res.attachments,
          ]);
        }
        setUploadCount(i + 1);
      }

      setUploading(false);
      queryClient.invalidateQueries({ queryKey: attachmentsQueryKey });

      if (all.length > remaining) {
        setAttachmentsError(
          `Прикреплено ${list.length} из ${all.length} — лимит ${MAX_ATTACHMENTS} файлов`,
        );
      } else if (lastError) {
        setAttachmentsError(lastError);
      }
    },
    [task?.id, attachments.length, queryClient, attachmentsQueryKey],
  );

  const handleDeleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (!task?.id || deletingId) return;
      setDeletingId(attachmentId);
      const res = await deleteTaskAttachment(task.id, attachmentId);
      if (res.success) {
        queryClient.setQueryData<TaskAttachment[]>(attachmentsQueryKey, (prev = []) =>
          prev.filter((a) => a.id !== attachmentId),
        );
        setAttachmentsError(null);
      } else {
        setAttachmentsError(res.error ?? null);
      }
      setDeletingId(null);
    },
    [task?.id, deletingId, queryClient, attachmentsQueryKey],
  );

  const handleDownloadAttachment = useCallback(
    async (attachment: TaskAttachment) => {
      if (!task?.id || downloadingId) return;
      setDownloadingId(attachment.id);
      setAttachmentsError(null);
      try {
        const url = await signTaskAttachment(task.id, attachment.id);

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
          let downloadFileFailed = false;
          const accepted = await new Promise<boolean>((resolve) => {
            try {
              tg.downloadFile!({ url, file_name: attachment.filename }, (ok) => resolve(!!ok));
            } catch {
              downloadFileFailed = true;
              resolve(false);
            }
          });
          // accepted=true → нативно скачано; callback(false) без исключения = пользователь
          // нажал «Отмена» → останавливаемся (не качаем повторно через blob).
          if (accepted) return;
          if (!downloadFileFailed) return;
        }

        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Не удалось получить файл');
          const blob = await resp.blob();
          const objUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objUrl;
          a.download = attachment.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
          return;
        } catch {
          throw new Error('Скачивание недоступно на этом клиенте. Попробуйте на телефоне.');
        }
      } catch (err) {
        setAttachmentsError(err instanceof Error ? err.message : 'Не удалось открыть файл');
      } finally {
        setDownloadingId(null);
      }
    },
    [task?.id, downloadingId],
  );

  const handleMoveConfirm = useCallback(
    (targetColumn: string) => {
      if (!task?.id || !onMoveTask) return;
      onMoveTask(task.id, targetColumn);
      setMoveSheetOpen(false);
      onClose();
    },
    [task, onMoveTask, onClose],
  );

  const handleSave = useCallback(async () => {
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
        external_links: linksEnabled ? links : [],
      };

      if (isNew) {
        const result = await createTask({
          title: title.trim(),
          description: description || undefined,
          column: 'backlog',
          story_points: storyPoints,
          cognitive_weight: cognitiveWeight,
          deadline: deadline ? deadline.toISOString() : undefined,
          metadata,
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
  }, [
    title,
    description,
    storyPoints,
    cognitiveWeight,
    deadline,
    checklistEnabled,
    relatedEnabled,
    linksEnabled,
    links,
    isNew,
    task,
    assignedTo,
    reviewerId,
    onSave,
    onClose,
  ]);

  const handleDeleteTask = useCallback(async () => {
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
  }, [task?.id, onDelete, onClose]);

  /* ---------- Derived ---------- */

  const findWorker = useCallback(
    (id: string | null): WorkerCardData | undefined => {
      if (!id) return undefined;
      return workers.find((w) => w.id === id);
    },
    [workers],
  );

  const assigneeWorker = findWorker(assignedTo);
  const reviewerWorker = findWorker(reviewerId);

  const availableForAssignee = workers.filter((w) => w.id !== reviewerId);
  const availableForReviewer = workers.filter((w) => w.id !== assignedTo);

    const attachLimitReached = attachments.length >= MAX_ATTACHMENTS;

  // REV-01: префилл «Что сделано» из последней сдачи для review-решения.
  const { data: latestSubmissionData } = useQuery({
    queryKey: ['task-submission-latest', task?.id],
        queryFn: () => getLatestTaskSubmission(task!.id!),
    enabled: !!(open && task?.id && task?.column === 'review' && isView),
    staleTime: 30_000,
  });
  const latestSubmission = latestSubmissionData?.submission ?? null;
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleApprove = useCallback(async () => {
    if (!task?.id) return;
    setReviewLoading(true);
    setReviewError(null);
    const res = await reviewTask(task.id, {
      action: 'approve',
      expected_version: task.version ?? undefined,
    });
    if ('error' in res) setReviewError(res.error);
    else onReviewResolved?.(res.task);
    setReviewLoading(false);
  }, [task, onReviewResolved]);

  const handleFix = useCallback(async (reason: string) => {
    if (!task?.id) return;
    setReviewLoading(true);
    setReviewError(null);
    const res = await reviewTask(task.id, {
      action: 'fix',
      reason,
      expected_version: task.version ?? undefined,
    });
    if ('error' in res) setReviewError(res.error);
    else onReviewResolved?.(res.task);
    setReviewLoading(false);
  }, [task, onReviewResolved]);

  /* ---------- Delete confirm modal (portal) ---------- */

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

  /* ---------- Render ---------- */

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        // Keyboard ride: фокус в полях (название/описание/комментарии) —
        // клавиатура «выталкивает» панель (visualViewport → translate),
        // потолок опускается синхронно, контент скроллится внутри.
        respectKeyboard
        keyboardRide
      >
        <div
          className={`flex flex-col gap-6 px-4 pb-6 ${className}`}
          aria-label={isView ? 'Просмотр задачи' : 'Редактирование задачи'}
          style={{
            // Вкладка «Комментарии» — чат: контент занимает ровно доступную
            // высоту шторки, поэтому лента (h-full) растягивается, а composer
            // прижат к нижней кромке (вместо прежних произвольных h-[60vh]).
            // Вкладка «Общее» высоту не задаёт — панель шторки скроллится как
            // раньше, а Segments-шапка липнет сверху.
            ...(tab === 'comments' && task?.id ? { height: SHEET_CONTENT_MAX_HEIGHT } : null),
          }}
        >
          {/* Segments — статичная шапка: sticky внутри скроллящейся панели, на
              своём стартовом месте (top = chrome drag handle), непрозрачный
              standard surface, чтобы контент проходил под ней. pb-6 + -mb-6:
              воздух gap-6 контейнера становится частью шапки (отступ под
              Segments) и не «съезжает» при скролле. */}
          <div
            className="sticky z-10 -mx-4 -mb-6 bg-[var(--color-surface)] px-4 pb-6"
            style={{ top: SHEET_CHROME_HEIGHT_PX }}
          >
            <Segments
              value={tab}
              onChange={(v) => setTab(v)}
              disabled={isEdit}
              options={[
                { value: 'general', label: 'Общее' },
                { value: 'comments', label: 'Комментарии' },
              ]}
            />
          </div>

          {tab === 'comments' && task?.id && (
            /* flex-col: панель комментариев обязана растянуться на всю ширину
               шторки. В строке (flex-row) единственный ребёнок получает ширину
               по контенту (shrink-to-fit) → лента и composer прижимались
               к левому краю. */
            <div className="flex min-h-0 flex-1 flex-col">
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

          {tab === 'general' && (
            <>
              <KeyContextSection
                title={title}
                description={description}
                deadline={deadline}
                isView={isView}
                onTitleChange={handleTitleChange}
                onDescriptionChange={handleDescriptionChange}
                onOpenDate={handleOpenDate}
              />

              <CostSection
                storyPoints={storyPoints}
                cognitiveWeight={cognitiveWeight}
                isView={isView}
                onStoryPointsChange={handleStoryPointsChange}
                onCognitiveWeightChange={handleCognitiveWeightChange}
              />

              <ResponsibilitySection
                task={task}
                workers={workers}
                assigneeWorker={assigneeWorker}
                reviewerWorker={reviewerWorker}
                isView={isView}
                onOpenAssignee={handleOpenAssignee}
                onOpenReviewer={handleOpenReviewer}
              />

              <ExtraContextSection
                checklistEnabled={checklistEnabled}
                relatedEnabled={relatedEnabled}
                linksEnabled={linksEnabled}
                links={links}
                isView={isView}
                onChecklistChange={handleChecklistChange}
                onRelatedChange={handleRelatedChange}
                onLinksEnabledChange={handleLinksEnabledChange}
                onLinksChange={handleLinksChange}
              />

              {!isNew && (
                <FilesSection
                  attachments={attachments}
                  attachmentsLoading={attachmentsLoading}
                  attachmentsErrorText={attachmentsErrorText}
                  uploading={uploading}
                  uploadCount={uploadCount}
                  uploadTotal={uploadTotal}
                  deletingId={deletingId}
                  downloadingId={downloadingId}
                  isView={isView}
                  attachLimitReached={attachLimitReached}
                  fileInputRef={fileInputRef}
                  onAttachClick={handleAttachClick}
                  onDelete={handleDeleteAttachment}
                  onDownload={handleDownloadAttachment}
                  onFileChange={handleAttachFiles}
                />
              )}
            </>
          )}

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

                    {/* REV-01: решение ревьюера (approve/fix) для задач в review */}
          {tab === 'general' && task?.column === 'review' && isView && (
            <ReviewDecisionBlock
              task={(task ?? null) as TaskEntity}
              currentUserId={currentUserId}
              latestSubmission={latestSubmission}
              loading={reviewLoading}
              error={reviewError}
              onApprove={handleApprove}
              onFix={handleFix}
            />
          )}

          {tab === 'general' && isView && !isNew && (
            <div className="mt-2 flex flex-col gap-2">
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

      {deleteConfirmModal}

      <WorkerSelectSheet
        open={assigneeSheetOpen}
        onClose={() => setAssigneeSheetOpen(false)}
        workers={availableForAssignee}
        selectedId={assignedTo}
        onSelect={(id) => {
          setAssignedTo(id);
          if (reviewerId === id) setReviewerId(null);
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
          if (assignedTo === id) setAssignedTo(null);
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
