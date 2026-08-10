'use client';

/**
 * TaskViewEdit — 2-in-1 task component (view/edit modes).
 *
 * Based on Figma node 1:663 (task-create).
 *
 * Wizard with 3 stages:
 *   1. Ключевой контекст (название, описание, дедлайн) + Стоимость (SP, CW)
 *   2. Ответственность (соисполнители, наблюдатели)
 *   3. Дополнительный контекст (чеклист, связанные, зависимые, внешние ссылки)
 *
 * View mode: all fields are disabled/readonly (like board view).
 * Edit mode: all fields are active with save/cancel actions.
 */

import { useState, useEffect } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import {
  TextInput,
  TextArea,
  Button,
  Stepper,
  ToggleSwitch,
  Segments,
  ProgressSteps,
} from '@/components/ui/desk-ui';
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

const STAGES = ['Ключевой контекст', 'Ответственность', 'Доп. контекст'] as const;
type Stage = (typeof STAGES)[number];

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex w-full items-center justify-between">
      <div className="flex items-center gap-2">
        <div style={{ width: 2, height: 18, backgroundColor: '#F59E0B', flexShrink: 0 }} />
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: '18px',
            fontWeight: 'var(--font-weight-medium)',
            color: '#FAFAFA',
          }}
        >
          {title}
        </span>
      </div>
    </div>
  );
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

  // Wizard state
  const [stage, setStage] = useState(0);
  const [creationMode, setCreationMode] = useState<'step' | 'all'>('step');

  // Form state
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [storyPoints, setStoryPoints] = useState(task?.story_points ?? 1);
  const [cognitiveWeight, setCognitiveWeight] = useState(task?.cognitive_weight ?? 1);
  const [deadline, setDeadline] = useState(task?.deadline ?? '');
  const [checklistEnabled, setChecklistEnabled] = useState(false);
  const [relatedEnabled, setRelatedEnabled] = useState(false);
  const [dependentEnabled, setDependentEnabled] = useState(false);
  const [linksEnabled, setLinksEnabled] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal mode when the sheet opens or the task changes
  useEffect(() => {
    if (open) {
      setInternalMode(mode);
      setStage(0);
      setError(null);
    }
  }, [open, mode]);

  // Sync state when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setStoryPoints(task.story_points ?? 1);
      setCognitiveWeight(task.cognitive_weight ?? 1);
      setDeadline(task.deadline ?? '');
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
      setStoryPoints(task.story_points ?? 1);
      setCognitiveWeight(task.cognitive_weight ?? 1);
      setDeadline(task.deadline ?? '');
    }
    setInternalMode('view');
    onClose();
  };

  const goNext = () => setStage((s) => Math.min(s + 1, STAGES.length - 1));
  const goPrev = () => setStage((s) => Math.max(s - 1, 0));

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div
        className={`flex flex-col gap-6 px-4 pb-6 ${className}`}
        aria-label={isView ? 'Просмотр задачи' : 'Создание задачи'}
      >
        {/* Segments: Поэтапно / Всё сразу */}
        <Segments
          value={creationMode}
          onChange={(v) => setCreationMode(v)}
          disabled={isView}
          options={[
            { value: 'step', label: 'Поэтапно' },
            { value: 'all', label: 'Всё сразу' },
          ]}
        />

        {/* Progress bar */}
        <ProgressSteps current={stage + 1} total={STAGES.length} />

        {/* Stage 1: Ключевой контекст + Стоимость */}
        {stage === 0 && (
          <div className="flex w-full flex-col gap-5">
            <div className="flex w-full flex-col gap-3">
              <SectionHeading title="Ключевой контекст" />
              <div className="flex w-full flex-col gap-3">
                <TextInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
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
                <TextInput
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  placeholder="Дедлайн"
                  disabled={isView}
                  corner="field"
                />
              </div>
            </div>

            <div className="flex w-full flex-col gap-3">
              <SectionHeading title="Стоимость" />
              <div className="flex w-full flex-col gap-3">
                <Stepper
                  value={storyPoints}
                  unitLabel={(n) => `${n} SP`}
                  min={1}
                  max={30}
                  onChange={setStoryPoints}
                  borderGradient={['#F59E0B', '#F59E0B']}
                  disabled={isView}
                />
                <Stepper
                  value={cognitiveWeight}
                  unitLabel={(n) => `${n} CW`}
                  min={1}
                  max={10}
                  onChange={setCognitiveWeight}
                  borderGradient={['#F59E0B', '#F59E0B']}
                  disabled={isView}
                />
              </div>
            </div>
          </div>
        )}

        {/* Stage 2: Ответственность */}
        {stage === 1 && (
          <div className="flex w-full flex-col gap-3">
            <SectionHeading title="Ответственность" />
            <div className="flex w-full flex-col gap-3">
              <Button variant="outline" disabled={isView} className="w-full">
                Добавить соисполнителей
              </Button>
              <Button variant="outline" disabled={isView} className="w-full">
                Добавить наблюдателей
              </Button>
            </div>
          </div>
        )}

        {/* Stage 3: Дополнительный контекст */}
        {stage === 2 && (
          <div className="flex w-full flex-col gap-3">
            <SectionHeading title="Дополнительный контекст" />
            <div className="flex w-full flex-col gap-3">
              <ToggleSwitch
                checked={checklistEnabled}
                onChange={setChecklistEnabled}
                label="Чеклист задачи"
                disabled={isView}
              />
              <ToggleSwitch
                checked={relatedEnabled}
                onChange={setRelatedEnabled}
                label="Связанные задачи"
                disabled={isView}
              />
              <ToggleSwitch
                checked={dependentEnabled}
                onChange={setDependentEnabled}
                label="Зависимые задачи"
                disabled={isView}
              />
              <ToggleSwitch
                checked={linksEnabled}
                onChange={setLinksEnabled}
                label="Внешние ссылки"
                disabled={isView}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
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

        {/* Actions */}
        {isView && !isNew && (
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => setInternalMode('edit')} className="flex-1">
              Редактировать
            </Button>
          </div>
        )}
        {isEdit && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {stage > 0 && (
                <Button onClick={goPrev} variant="outline" className="flex-1">
                  Назад
                </Button>
              )}
              {stage < STAGES.length - 1 ? (
                <Button onClick={goNext} className="flex-1">
                  Далее
                </Button>
              ) : (
                <Button onClick={handleSave} disabled={loading || !title.trim()} className="flex-1">
                  {loading ? 'Сохранение...' : 'Сохранить'}
                </Button>
              )}
            </div>
            <Button onClick={handleCancel} variant="outline" className="w-full">
              Отмена
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}