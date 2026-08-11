'use client';

/**
 * TaskForm — manual task creation form (FLOW-06).
 *
 * Creates tasks with is_inbox=false when a column is explicitly chosen,
 * or is_inbox=true when no column is specified.
 *
 * Based on: Master §5, TASKS.md Stage 4 FLOW-06
 * Design system: TextInput, TextArea, Button from desk-ui
 */

import { useState, useCallback } from 'react';
import { TextInput, TextArea, Button } from '@/components/ui/desk-ui';
import { createTask } from '@/lib/api/flow';
import type { TaskEntity } from '@/types/flowboard';

export interface TaskFormProps {
  onSubmit?: (task: TaskEntity) => void;
  onCancel?: () => void;
  defaultColumn?: string;
  className?: string;
}

const COLUMNS = [
  { value: 'backlog', label: 'В очереди' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
];

const PRIORITIES = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' },
];

const WEIGHTS = [0, 1, 2, 3];

export function TaskForm({ onSubmit, onCancel, defaultColumn = 'backlog', className }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [column, setColumn] = useState(defaultColumn);
  const [priority, setPriority] = useState('medium');
  const [cognitiveWeight, setCognitiveWeight] = useState(1);
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await createTask({
        title: title.trim(),
        description: description || undefined,
        column: column !== undefined ? column : undefined,
        priority,
        cognitive_weight: cognitiveWeight,
        deadline: deadline || undefined,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.task) {
        setTitle('');
        setDescription('');
        setDeadline('');
        onSubmit?.(result.task);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания задачи');
    } finally {
      setLoading(false);
    }
  }, [title, description, column, priority, cognitiveWeight, deadline, onSubmit]);

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${className || ''}`} aria-label="Создание задачи">
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
          Название *
        </label>
        <TextInput
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Введите название задачи..."
          required
          maxLength={500}
          corner="field"
          aria-required="true"
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
          maxLength={5000}
          corner="field"
        />
      </div>

      {/* Column */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Колонка
        </label>
        <select
          value={column}
          onChange={(e) => setColumn(e.target.value)}
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: 'var(--radius-flowboard-section)',
          }}
        >
          {COLUMNS.map((col) => (
            <option key={col.value} value={col.value}>
              {col.label}
            </option>
          ))}
        </select>
      </div>

      {/* Priority */}
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
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: 'var(--radius-flowboard-section)',
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Cognitive Weight */}
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
          {WEIGHTS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setCognitiveWeight(w)}
              className="flex items-center justify-center w-8 h-8 rounded border transition-colors"
              style={{
                borderColor: cognitiveWeight === w ? 'var(--color-accent-amber)' : 'var(--color-border-default)',
                backgroundColor: cognitiveWeight === w ? 'var(--color-accent-amber-subtle)' : 'transparent',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: cognitiveWeight === w ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
              }}
              aria-label={`Вес ${w}`}
              aria-pressed={cognitiveWeight === w}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Deadline */}
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
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: 'var(--radius-flowboard-section)',
          }}
        />
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
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="solid"
          disabled={loading || !title.trim()}
          className="flex-1"
        >
          {loading ? 'Создание...' : 'Создать'}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex-1"
          >
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}
