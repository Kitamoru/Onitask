'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextInput } from '@/components/ui/desk-ui';
import { taskColumnLabel } from '@/lib/taskColumns';
import type { TaskEntity } from '@/types/flowboard';
import type { TaskRelationDirection } from '@/types/taskRelations';

export interface RelatedTaskPickerSheetProps {
  open: boolean;
  onClose: () => void;
  direction: TaskRelationDirection;
  currentTask: TaskEntity;
  tasks: TaskEntity[];
  excludedTaskIds: Set<string>;
  onSelect: (task: TaskEntity) => Promise<void>;
}

export function RelatedTaskPickerSheet({
  open,
  onClose,
  direction,
  currentTask,
  tasks,
  excludedTaskIds,
  onSelect,
}: RelatedTaskPickerSheetProps) {
  const [query, setQuery] = useState('');
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return tasks
      .filter((task) =>
        task.id !== currentTask.id
        && task.column !== 'done'
        && !excludedTaskIds.has(task.id),
      )
      .filter((task) => !needle
        || task.full_id.toLocaleLowerCase('ru-RU').includes(needle)
        || task.title.toLocaleLowerCase('ru-RU').includes(needle))
      .slice(0, 30);
  }, [currentTask.id, excludedTaskIds, query, tasks]);

  const title = direction === 'blocked_by'
    ? 'Выберите обязательную задачу'
    : 'Выберите задачу после этой';

  const handleSelect = async (task: TaskEntity) => {
    setSavingTaskId(task.id);
    setError(null);
    try {
      await onSelect(task);
      setQuery('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать связь');
    } finally {
      setSavingTaskId(null);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} stacked>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-[17px] font-semibold text-text">{title}</h3>
          <p className="text-[13px] text-text-muted">
            {direction === 'blocked_by'
              ? 'Эта задача не завершится, пока выбранная не будет сделана.'
              : 'Выбранная задача будет ждать завершения текущей.'}
          </p>
        </div>

        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={direction === 'blocked_by' ? 'Найти блокер' : 'Найти downstream-задачу'}
          aria-label="Поиск задачи"
          autoFocus
        />

        {error && (
          <div className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]" role="alert">
            {error}
          </div>
        )}

        <div className="flex max-h-[55dvh] flex-col gap-2 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-5 text-center text-sm text-text-muted">
              Нет подходящих задач
            </p>
          ) : candidates.map((task) => (
            <button
              key={task.id}
              type="button"
              disabled={savingTaskId !== null}
              onClick={() => void handleSelect(task)}
              className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-3 text-left transition-colors hover:border-text-muted disabled:opacity-50"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-mono text-xs text-text-muted">{task.full_id}</span>
                <span className="truncate text-[15px] font-medium text-text">{task.title}</span>
                <span className="text-xs text-text-muted">{taskColumnLabel(task.column)}</span>
              </div>
              {savingTaskId === task.id && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />
              )}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
