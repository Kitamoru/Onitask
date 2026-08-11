'use client';

/**
 * TaskViewEdit — 2-in-1 task component (view/edit modes).
 *
 * View mode: all fields are disabled/readonly (like board view) with a
 * solid "Редактировать" button at the bottom.
 * Edit mode: all fields are active with save/cancel actions.
 *
 * Layout: single canvas (no wizard steps) with sections:
 *   - Ключевой контекст (название, описание, дедлайн)
 *   - Стоимость (SP/CW steppers)
 *   - Ответственность (соисполнители, наблюдатели)
 *   - Дополнительный контекст (чеклист, связанные, зависимые, внешние ссылки)
 *
 * Segments: "Общее" (active) / "Комментарии" (inactive — later).
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
  SectionHeader,
  Card,
} from '@/components/ui/desk-ui';
import { SingleDateField } from '@/components/ui/SingleDateField';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
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

  // Segments: Общее (active) / Комментарии (inactive)
  const [tab, setTab] = useState<'general' | 'comments'>('general');

  // Form state
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [storyPoints, setStoryPoints] = useState(task?.story_points ?? 1);
  const [cognitiveWeight, setCognitiveWeight] = useState(task?.cognitive_weight ?? 1);
  const [deadline, setDeadline] = useState<Date | null>(task?.deadline ? new Date(task.deadline) : null);
  const [checklistEnabled, setChecklistEnabled] = useState(false);
  const [relatedEnabled, setRelatedEnabled] = useState(false);
  const [dependentEnabled, setDependentEnabled] = useState(false);
  const [linksEnabled, setLinksEnabled] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);

  // Reset internal mode when the sheet opens or the task changes
  useEffect(() => {
    if (open) {
      setInternalMode(mode);
      setTab('general');
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
      setDeadline(task.deadline ? new Date(task.deadline) : null);
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
        const result = await patchTask(task.id, {
          title: title.trim(),
          description: description || undefined,
          cognitive_weight: cognitiveWeight,
          deadline: deadline ? deadline.toISOString() : undefined,
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
      setDeadline(task.deadline ? new Date(task.deadline) : null);
    }
    setInternalMode('view');
    onClose();
  };

  return (
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

        {/* Ключевой контекст */}
        <section>
          <SectionHeader title="Ключевой контекст" />
          <div className="flex flex-col gap-3">
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
              borderGradient={['var(--color-grad-add-from)', 'var(--color-grad-add-to)']}
              disabled={isView}
            />
            <Stepper
              value={cognitiveWeight}
              unitLabel={(n) => `${n} CW`}
              min={1}
              max={10}
              onChange={setCognitiveWeight}
              borderGradient={['var(--color-grad-add-from)', 'var(--color-grad-add-to)']}
              disabled={isView}
            />
          </div>
        </section>

        {/* Ответственность */}
        <section>
          <SectionHeader title="Ответственность" />
          <div className="flex flex-col gap-3">
            <Button variant="outline" disabled={isView} className="w-full">
              Добавить исполнителя
            </Button>
            <Button variant="outline" disabled={isView} className="w-full">
              Добавить соисполнителей
            </Button>
            <Button variant="outline" disabled={isView} className="w-full">
              Добавить наблюдателей
            </Button>
          </div>
        </section>

        {/* Дополнительный контекст */}
        <section>
          <SectionHeader title="Дополнительный контекст" />
          <div className="flex flex-col gap-3">
            <Card>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-text">Чеклист задачи</span>
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
                <span className="text-[15px] font-medium text-text">Связанные задачи</span>
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
                <span className="text-[15px] font-medium text-text">Зависимые задачи</span>
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
                <span className="text-[15px] font-medium text-text">Внешние ссылки</span>
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
          <div className="mt-2">
            <Button
              variant="solid"
              onClick={() => setInternalMode('edit')}
              className="w-full"
            >
              Редактировать
            </Button>
          </div>
        )}
        {isEdit && (
          <div className="mt-2 flex flex-col gap-2">
            <Button
              onClick={handleSave}
              disabled={loading || !title.trim()}
              variant="solid"
              className="w-full"
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </Button>
            <Button onClick={handleCancel} variant="outline" className="w-full">
              Отмена
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
  );
}
