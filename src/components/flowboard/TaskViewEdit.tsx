'use client';

/**
 * TaskViewEdit — 2-in-1 task component (view/edit modes).
 *
 * View mode: all fields are disabled/readonly (like board view).
 * Edit mode: all fields are active with save/cancel actions.
 *
 * Based on: Figma node 1:663 (task-create), component-map.md
 * Design system: desk-ui primitives
 */

import { useState, useEffect } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextInput, TextArea, Button } from '@/components/ui/desk-ui';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { patchTask, createTask } from '@/lib/api/flow';

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
  className = '',
}: TaskViewEditProps) {
  const [internalMode, setInternalMode] = useState<'view' | 'edit'>(mode);
  const isView = internalMode === 'view';
  const isEdit = internalMode === 'edit';
  const isNew = !task?.id;

  // Form state
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [storyPoints, setStoryPoints] = useState<number | null>(task?.story_points ?? null);
  const [cognitiveWeight, setCognitiveWeight] = useState(task?.cognitive_weight ?? 1);
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to ?? null);
  const [reviewerId, setReviewerId] = useState(task?.reviewer_id ?? null);
  const [deadline, setDeadline] = useState(task?.deadline ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 'medium');
  const [checklist, setChecklist] = useState<string[]>(
    (task?.metadata?.checklist as string[]) ?? []
  );
  const [relatedTasks, setRelatedTasks] = useState<string[]>(
    (task?.metadata?.related_tasks as string[]) ?? []
  );
  const [externalLinks, setExternalLinks] = useState<{ name: string; url: string }[]>(
    (task?.metadata?.external_links as { name: string; url: string }[]) ?? []
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal mode when the sheet opens or the task changes
  useEffect(() => {
    if (open) {
      setInternalMode(mode);
      setError(null);
    }
  }, [open, mode]);

  // Sync state when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setStoryPoints(task.story_points ?? null);
      setCognitiveWeight(task.cognitive_weight ?? 1);
      setAssignedTo(task.assigned_to ?? null);
      setReviewerId(task.reviewer_id ?? null);
      setDeadline(task.deadline ?? '');
      setPriority(task.priority ?? 'medium');
      setChecklist((task.metadata?.checklist as string[]) ?? []);
      setRelatedTasks((task.metadata?.related_tasks as string[]) ?? []);
      setExternalLinks((task.metadata?.external_links as { name: string; url: string }[]) ?? []);
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
        checklist,
        related_tasks: relatedTasks,
        external_links: externalLinks,
      };

      if (isNew) {
        const result = await createTask({
          title: title.trim(),
          description: description || undefined,
          column: 'backlog',
          priority,
          cognitive_weight: cognitiveWeight,
          deadline: deadline || undefined,
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
        const result = await patchTask(task.id, {
          title: title.trim(),
          description: description || undefined,
          priority,
          cognitive_weight: cognitiveWeight,
          deadline: deadline || undefined,
          metadata,
        });

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

  const handleCancel = () => {
    if (task) {
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setStoryPoints(task.story_points ?? null);
      setCognitiveWeight(task.cognitive_weight ?? 1);
      setAssignedTo(task.assigned_to ?? null);
      setReviewerId(task.reviewer_id ?? null);
      setDeadline(task.deadline ?? '');
      setPriority(task.priority ?? 'medium');
    }
    setInternalMode('view');
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className={`flex flex-col gap-4 px-4 pb-6 ${className}`} aria-label={isView ? 'Просмотр задачи' : 'Редактирование задачи'}>
        {/* Title */}
        <div className="flex flex-col gap-1">
          <label
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
            }}
          >
            Название
          </label>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Введите название задачи..."
            disabled={isView}
            maxLength={500}
            corner="field"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
            }}
          >
            Описание
          </label>
          <TextArea
            value={description}
            onChange={setDescription}
            placeholder="Описание задачи..."
            disabled={isView}
            maxLength={5000}
            corner="field"
          />
        </div>

        {/* Story Points & Cognitive Weight */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              Стори пойнты
            </label>
            <input
              type="number"
              value={storyPoints ?? ''}
              onChange={(e) => setStoryPoints(e.target.value ? Number(e.target.value) : null)}
              disabled={isView}
              min={0}
              max={100}
              className="w-full px-3 py-2 rounded border bg-transparent text-sm"
              style={{
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--text-body-sm)',
                borderRadius: 'var(--radius-flowboard-section)',
                opacity: isView ? 0.6 : 1,
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              Когнитивный вес
            </label>
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setCognitiveWeight(w)}
                  disabled={isView}
                  className="flex items-center justify-center w-8 h-8 rounded border transition-colors"
                  style={{
                    borderColor: cognitiveWeight === w ? 'var(--color-accent-amber)' : 'var(--color-border-default)',
                    backgroundColor: cognitiveWeight === w ? 'var(--color-accent-amber-subtle)' : 'transparent',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-family-display)',
                    fontSize: 'var(--text-body-sm)',
                    fontWeight: cognitiveWeight === w ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
                    opacity: isView ? 0.6 : 1,
                    cursor: isView ? 'not-allowed' : 'pointer',
                  }}
                  aria-label={`Вес ${w}`}
                  aria-pressed={cognitiveWeight === w}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Assigned To & Reviewer */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              Исполнитель
            </label>
            <select
              value={assignedTo ?? ''}
              onChange={(e) => setAssignedTo(e.target.value || null)}
              disabled={isView}
              className="w-full px-3 py-2 rounded border bg-transparent text-sm"
              style={{
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--text-body-sm)',
                borderRadius: 'var(--radius-flowboard-section)',
                opacity: isView ? 0.6 : 1,
              }}
            >
              <option value="">— Не назначен —</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              Наблюдатель
            </label>
            <select
              value={reviewerId ?? ''}
              onChange={(e) => setReviewerId(e.target.value || null)}
              disabled={isView}
              className="w-full px-3 py-2 rounded border bg-transparent text-sm"
              style={{
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--text-body-sm)',
                borderRadius: 'var(--radius-flowboard-section)',
                opacity: isView ? 0.6 : 1,
              }}
            >
              <option value="">— Не назначен —</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Deadline & Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              Дедлайн
            </label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={isView}
              className="w-full px-3 py-2 rounded border bg-transparent text-sm"
              style={{
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--text-body-sm)',
                borderRadius: 'var(--radius-flowboard-section)',
                opacity: isView ? 0.6 : 1,
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              Приоритет
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={isView}
              className="w-full px-3 py-2 rounded border bg-transparent text-sm"
              style={{
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--text-body-sm)',
                borderRadius: 'var(--radius-flowboard-section)',
                opacity: isView ? 0.6 : 1,
              }}
            >
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="px-3 py-2 rounded text-sm"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--color-priority-red-text)',
              border: `1px solid var(--color-priority-red-border)`,
              borderRadius: 'var(--radius-flowboard-section)',
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Actions */}
        {isView && !isNew && (
          <div className="flex items-center gap-2 mt-2">
            <Button
              onClick={() => setInternalMode('edit')}
              className="flex-1"
            >
              Редактировать
            </Button>
          </div>
        )}
        {isEdit && (
          <div className="flex items-center gap-2 mt-2">
            <Button
              onClick={handleSave}
              disabled={loading || !title.trim()}
              className="flex-1"
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </Button>
            <Button
              onClick={handleCancel}
              variant="outline"
              className="flex-1"
            >
              Отмена
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}