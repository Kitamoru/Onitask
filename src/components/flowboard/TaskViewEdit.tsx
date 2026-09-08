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
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
} from '@/components/ui/desk-ui';
import { SingleDateField } from '@/components/ui/SingleDateField';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { patchTask, createTask, deleteTask } from '@/lib/api/flow';
import ParticipantCard from './ParticipantCard';
import { WorkerSelectSheet } from './WorkerSelectSheet';
import { MoveTaskSheet } from './MoveTaskSheet';
import { TaskCommentsPanel } from './TaskCommentsPanel';

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
  const [dependentEnabled, setDependentEnabled] = useState(false);
  const [linksEnabled, setLinksEnabled] = useState(false);

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
      setTab('general');
      setError(null);
      setShowDeleteConfirm(false);
    }
  }, [open, mode]);

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
        dependent_tasks: dependentEnabled ? (task?.metadata?.dependent_tasks ?? []) : [],
        external_links: linksEnabled ? (task?.metadata?.external_links ?? []) : [],
      };

      if (isNew) {
        const result = await createTask({
          title: title.trim(),
          description: description || undefined,
          column: 'backlog',
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
  const availableForAssignee = workers.filter(
    (w) => w.id !== reviewerId,
  );
  const availableForReviewer = workers.filter(
    (w) => w.id !== assignedTo,
  );

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
                    Зависимые задачи
                  </span>
                  <ToggleSwitch
                    checked={dependentEnabled}
                    onChange={setDependentEnabled}
                    label="Зависимые задачи"
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
